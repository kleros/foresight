import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  isAddressEqual,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  UserRejectedRequestError,
  type Address,
  type Hash,
} from "viem";
import { gnosis } from "viem/chains";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PredictOption } from "@/features/predict/flow/types";
import type { SelectedEstimate } from "@/features/predict/types";
import type { SessionDetail, SessionStatus } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { publicClient } from "@/lib/web3/public-client";

import { addresses, GATEWAY } from "@/testing/fixtures";

import { PredictRunner } from "../PredictRunner";

/** The popup over the real run, with the wallet and chain faked: status resolved or unknown starts no new transaction. */

/* Predictions run on gnosis only; the test environment would otherwise default to the local chain. */
vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_LOCAL_CHAIN", "false");
});

const WAD = 10n ** 18n;

const A = "0xa11ce000000000000000000000000000000a11ce" as Address;
const A_EXECUTOR = "0xa11ce000000000000000000000000000000e0e0a" as Address;

/** What the visit before the reload put in, and what the form holds on reopening. */
const SAVED = { deposit: 725n * 10n ** 16n, estimate: 410 } as const;
const CURRENT = { deposit: WAD, estimate: 250 } as const;

const wallet = vi.hoisted(() => ({
  address: undefined as `0x${string}` | undefined,
  chainId: undefined as number | undefined,
}));

/** The amount and estimate the popup's form holds right now. */
const form = vi.hoisted(() => ({ deposit: 0n, estimate: 0 }));

interface Prompt {
  from: `0x${string}`;
  chainId: number | undefined;
  to: `0x${string}`;
  data?: `0x${string}`;
  hash: `0x${string}`;
}

const chain = vi.hoisted(() => ({
  prompts: [] as Prompt[],
  /** One answer per prompt, in order; accept once they run out. */
  answers: [] as Array<"accept" | "reject">,
  receipts: new Map<string, "success" | "reverted">(),
  known: new Set<string>(),
  /** Receipt waits block until `mine()` while this is set. */
  holdMining: false,
  waiting: [] as Array<() => void>,
  deployed: true,
  /** The target prices every build asked the chain about, in order. */
  asked: [] as bigint[][],
  /** The options the last build asked the chain about, which the quoter prices. */
  options: [] as PredictOption[],
  /** Pool reads block until `releaseReads()` while this is set. */
  holdReads: false,
  readsWaiting: [] as Array<() => void>,
}));

function releaseReads() {
  chain.holdReads = false;
  chain.readsWaiting.splice(0).forEach((release) => release());
}

function mine() {
  chain.holdMining = false;
  chain.waiting.splice(0).forEach((release) => release());
}

vi.mock("@wagmi/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wagmi/core")>();
  const named = (name: string) => Object.assign(new Error(name), { name });
  const connection = () => ({
    address: wallet.address,
    addresses: wallet.address ? [wallet.address] : [],
    chainId: wallet.chainId,
    isConnected: wallet.address !== undefined,
    status: wallet.address ? "connected" : "disconnected",
  });

  return {
    ...actual,
    getConnection: connection,
    getAccount: connection,
    getChainId: () => wallet.chainId,
    sendTransaction: vi.fn(
      async (
        _config: unknown,
        params: {
          to: `0x${string}`;
          data?: `0x${string}`;
          account?: `0x${string}` | { address: `0x${string}` };
          chainId?: number;
        },
      ) => {
        if (!wallet.address) throw named("ConnectorNotConnectedError");
        const account = typeof params.account === "object" ? params.account.address : params.account;
        if (account !== undefined && account.toLowerCase() !== wallet.address.toLowerCase()) {
          throw named("ConnectorAccountNotFoundError");
        }
        if (params.chainId !== undefined && params.chainId !== wallet.chainId)
          throw named("ConnectorChainMismatchError");

        const hash = `0x${(chain.prompts.length + 1).toString(16).padStart(64, "0")}` as `0x${string}`;
        chain.prompts.push({ from: wallet.address, chainId: wallet.chainId, to: params.to, data: params.data, hash });
        if ((chain.answers.shift() ?? "accept") === "reject") {
          throw new UserRejectedRequestError(new Error("User denied transaction signature."));
        }
        chain.known.add(hash);
        return hash;
      },
    ),
  };
});

vi.mock("wagmi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wagmi")>();
  const connection = () => ({
    ...wallet,
    addresses: wallet.address ? [wallet.address] : [],
    isConnected: Boolean(wallet.address),
  });
  return { ...actual, useAccount: connection, useConnection: connection, useChainId: () => wallet.chainId };
});

vi.mock("@/lib/web3/wagmi", () => ({ wagmiConfig: {} }));
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));

vi.mock("@/lib/web3/public-client", () => {
  const receipt = (hash: Hash, status: "success" | "reverted") => ({
    transactionHash: hash,
    status,
    blockNumber: 19_000_000n,
    blockHash: `0x${"b".repeat(64)}`,
    logs: [],
  });

  return {
    publicClient: {
      async waitForTransactionReceipt({ hash }: { hash: Hash }) {
        if (!chain.receipts.has(hash) && chain.holdMining) {
          await new Promise<void>((release) => chain.waiting.push(release));
        }
        const status = chain.receipts.get(hash) ?? "success";
        chain.receipts.set(hash, status);
        return receipt(hash, status);
      },
      async getTransactionReceipt({ hash }: { hash: Hash }) {
        const status = chain.receipts.get(hash);
        if (!status) throw new TransactionReceiptNotFoundError({ hash });
        return receipt(hash, status);
      },
      async getTransaction({ hash }: { hash: Hash }) {
        if (!chain.known.has(hash)) throw new TransactionNotFoundError({ hash });
        return { hash };
      },
    },
  };
});

vi.mock("@/features/predict/run/reader", async () => {
  const { chainState } = await import("@/features/predict/flow/__tests__/support/fakes");
  return {
    createPredictReader: () => ({
      isExecutorDeployed: () => Promise.resolve(chain.deployed),
      collateralBalance: () => Promise.resolve(0n),
      creditsBalance: () => Promise.resolve(0n),
      managerCollateral: () => Promise.resolve(0n),
      previewDeposit: (assets: bigint) => Promise.resolve(assets),
      vaultValue: (shares: bigint) => Promise.resolve(shares),
      latestBlock: () => Promise.resolve(1n),
      blockGasLimit: () => Promise.resolve(17_000_000n),
      estimateGas: () => Promise.reject(new Error("execution reverted")),
      landedSince: () => Promise.resolve([]),
      hasPending: () => Promise.resolve(false),
      nextNonce: () => Promise.resolve(0),
      sentWithNonce: () => Promise.resolve({ status: "none" as const }),
      optionStates: async ({ options }: { options: PredictOption[] }) => {
        if (chain.holdReads) await new Promise<void>((release) => chain.readsWaiting.push(release));
        chain.asked.push(options.map((option) => option.targetPriceWad));
        chain.options = options;
        return options.map(() => chainState());
      },
    }),
  };
});

vi.mock("@/lib/swap/lens", async () => {
  const { fakeCreditsQuoter, poolQuoter } = await import("@/features/predict/flow/__tests__/support/fakes");
  return {
    createLensQuoter: () => poolQuoter(() => chain.options),
    createLensExactInputQuoter: () => fakeCreditsQuoter(),
  };
});

vi.mock("@/features/trade-executor/api/getExecutor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/trade-executor/api/getExecutor")>()),
  useExecutor: () => ({ data: { predicted: wallet.address ? A_EXECUTOR : undefined, deployed: chain.deployed } }),
}));

vi.mock("../usePredictFunding", () => ({
  usePredictFunding: () => ({
    credits: { state: "none" },
    funding: {
      available: 10n * 10n ** 18n,
      creditsAvailable: 0n,
      credits: [],
      creditsIn: 0n,
      collateralIn: form.deposit,
      tradeWallet: 0n,
      fromTradeWallet: 0n,
      toAdd: form.deposit,
      deposit: form.deposit,
    },
    canPayNative: false,
    isPending: false,
  }),
}));
vi.mock("../useHasPredicted", () => ({ useHasPredicted: () => true }));
// a live preview for every estimate in the form, which a reopened run's summary must not show; its plans are
// the fake chain's pools for the form's split, which a new run is held to
vi.mock("../usePricePreview", async (importOriginal) => {
  const { chainState } = await import("@/features/predict/flow/__tests__/support/fakes");
  const { previewTrades } = await import("@/features/predict/utils/plan");
  const { toPredictOptions } = await import("../toPredictOptions");
  const state = chainState();
  return {
    ...(await importOriginal<typeof import("../usePricePreview")>()),
    usePricePreview: (args: {
      session: SessionDetail;
      selected: SelectedEstimate[];
      collateralIn: bigint | undefined;
      slippageBps: number;
    }) => ({
      moves: Object.fromEntries(
        args.selected.map((estimate) => [estimate.scale.market.toLowerCase(), { from: 300, to: 350 }]),
      ),
      plans: Object.fromEntries(
        toPredictOptions(args.session, args.selected).map((option) => [
          option.childMarket.toLowerCase(),
          previewTrades(
            {
              pools: state.pools,
              targetPriceWad: option.targetPriceWad,
              held: state.held,
              splitAmount: state.underlying + (args.collateralIn ?? 0n),
            },
            args.slippageBps,
          )!,
        ]),
      ),
      held: {},
      ready: true,
      failed: false,
    }),
  };
});

afterAll(() => {
  vi.unstubAllEnvs();
});

const SESSION_ID = "7";

const session = () =>
  toSessionDetail(
    {
      ...sessionDetailColumns,
      id: SESSION_ID,
      collateralToken: addresses.collateralToken,
      children: [sessionChildRow({ id: addresses.childMarkets[0] })],
    },
    GATEWAY,
  );

const selectedAt = (detail: ReturnType<typeof session>, value: number): SelectedEstimate[] =>
  detail.options.map((option) => ({ scale: option, value, marketEstimate: 200, direction: "higher" }));

function connect(address: Address | undefined) {
  wallet.address = address;
  wallet.chainId = address === undefined ? undefined : gnosis.id;
}

function fill(values: { deposit: bigint; estimate: number }) {
  form.deposit = values.deposit;
  form.estimate = values.estimate;
}

function renderRunner(status: SessionStatus = "trading") {
  const detail = session();
  const selected = selectedAt(detail, form.estimate);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSuccess = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const ui = (at: SessionStatus) => (
    <PredictRunner session={detail} status={at} selected={selected} onClose={vi.fn()} onSuccess={onSuccess} />
  );
  const view: RenderResult = render(ui(status), { wrapper });
  return { ...view, onSuccess, rerenderAt: (at: SessionStatus) => view.rerender(ui(at)) };
}

const predictButton = () => screen.getByRole("button", { name: "Predict" });

/** Lets a run that is not going to prompt finish whatever it does instead. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const isDeposit = (prompt: Prompt) => isAddressEqual(prompt.to, addresses.collateralToken);
/** Text on the page and values in its fields, which is everything the visitor can read. */
function onScreen(): string {
  const fields = Array.from(document.querySelectorAll("input")).map((input) => input.value);
  return [document.body.textContent ?? "", ...fields].join("\n");
}

/** The visit before the reload: A predicts with the saved amount and estimate. */
async function firstVisit(answers: Array<"accept" | "reject">, opts: { holdMining?: boolean } = {}) {
  connect(A);
  fill(SAVED);
  chain.answers.push(...answers);
  chain.holdMining = opts.holdMining ?? false;
  const view = renderRunner();
  await waitFor(() => expect(predictButton()).toBeEnabled());
  await userEvent.click(predictButton());
  return view;
}

/** A turns the deposit down and reloads. */
async function leaveRejectedDeposit() {
  const view = await firstVisit(["reject"]);
  await waitFor(() => expect(onScreen()).toContain("You declined in your wallet."));
  view.unmount();
}

/** A signs the deposit and reloads before it mines. Returns its hash. */
async function leaveSubmittedDeposit() {
  const view = await firstVisit([], { holdMining: true });
  await waitFor(() => expect(chain.prompts.some(isDeposit)).toBe(true));
  view.unmount();
  return chain.prompts.find(isDeposit)!.hash;
}

/** Reopens the popup with the current form, and lets anything that would start on its own start. */
async function reopen(values: { deposit: bigint; estimate: number } = CURRENT, status: SessionStatus = "trading") {
  connect(A);
  fill(values);
  const before = chain.prompts.length;
  const view = renderRunner(status);
  await settle();
  return { ...view, before, since: () => chain.prompts.slice(before) };
}

beforeEach(() => {
  window.localStorage.clear();
  chain.prompts.length = 0;
  chain.answers.length = 0;
  chain.receipts.clear();
  chain.known.clear();
  chain.waiting.length = 0;
  chain.asked.length = 0;
  chain.holdMining = false;
  chain.readsWaiting.length = 0;
  chain.holdReads = false;
  chain.deployed = true;
  connect(undefined);
  fill(CURRENT);
});
const UNKNOWN = /Couldn't check whether this session has resolved/;
const REASON = { resolved: /resolved/i, unknown: UNKNOWN } as const;

/** Presses each control that starts or continues a run, enabled or not. */
async function pressEverythingThatSends() {
  for (const name of [/^Predict$/, /^Resume$/, /^Try the rest$/, /^Confirm/, /^Sign again$/]) {
    for (const button of screen.queryAllByRole("button", { name })) {
      await userEvent.click(button).catch(() => undefined);
    }
  }
  await settle();
}

describe.each(["resolved", "unknown"] as const)("A8 the popup, with the real run, under status %s", (status) => {
  it("says why and sends nothing when opened under it", async () => {
    connect(A);
    fill(CURRENT);
    renderRunner(status);
    await settle();

    await waitFor(() => expect(onScreen()).toMatch(REASON[status]));
    await pressEverythingThatSends();

    expect(chain.prompts).toEqual([]);
  });

  it("sends nothing when the status changes while the run reads the pools before its first transaction", async () => {
    connect(A);
    fill(SAVED);
    const view = renderRunner();
    await waitFor(() => expect(predictButton()).toBeEnabled());
    chain.holdReads = true;
    await userEvent.click(predictButton());
    await waitFor(() => expect(chain.readsWaiting.length).toBeGreaterThan(0));

    view.rerenderAt(status);
    releaseReads();
    await settle();
    await settle();

    expect(chain.prompts).toEqual([]);
    expect(onScreen()).toMatch(REASON[status]);
  });

  it("sends no further transaction when the status changes between the deposit and the prediction", async () => {
    const view = await firstVisit([], { holdMining: true });
    await waitFor(() => expect(chain.prompts.some(isDeposit)).toBe(true));
    const sent = chain.prompts.length;

    view.rerenderAt(status);
    mine();
    await settle();
    await settle();
    await pressEverythingThatSends();

    expect(chain.prompts).toHaveLength(sent);
  });

  it("does not try a stopped run again", async () => {
    const view = await firstVisit(["accept", "reject"]);
    await waitFor(() => expect(onScreen()).toContain("You declined in your wallet."));
    const sent = chain.prompts.length;

    view.rerenderAt(status);
    await settle();
    await pressEverythingThatSends();

    expect(chain.prompts).toHaveLength(sent);
    expect(onScreen()).toMatch(REASON[status]);
  });

  it("reopens a stored run for review and sends nothing on Resume", async () => {
    await leaveRejectedDeposit();

    const { since } = await reopen(CURRENT, status);
    await waitFor(() => expect(onScreen()).toContain("7.25"));
    await pressEverythingThatSends();

    expect(since()).toEqual([]);
  });

  it("still reads a transaction in flight to its receipt, and shows the stored run", async () => {
    const hash = await leaveSubmittedDeposit();
    const waits = vi.spyOn(publicClient, "waitForTransactionReceipt");
    const reads = vi.spyOn(publicClient, "getTransactionReceipt");
    // only reads the reopened popup makes count; the first visit's wait is still pending
    waits.mockClear();
    reads.mockClear();
    const asked = () => [...waits.mock.calls, ...reads.mock.calls].map(([args]) => args.hash);

    const { since } = await reopen(CURRENT, status);
    await waitFor(() => expect(onScreen()).toContain("7.25"));
    mine();
    await settle();

    await waitFor(() => expect(asked()).toContain(hash));
    expect(since()).toEqual([]);
    waits.mockRestore();
    reads.mockRestore();
  });
});

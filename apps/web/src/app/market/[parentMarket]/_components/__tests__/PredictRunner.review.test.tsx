import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  decodeFunctionData,
  erc20Abi,
  isAddressEqual,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  UserRejectedRequestError,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { gnosis } from "viem/chains";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PredictOption } from "@/features/predict/flow/types";
import type { SelectedEstimate } from "@/features/predict/types";
import type { SessionDetail } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { addresses, GATEWAY } from "@/testing/fixtures";

import { PredictRunner } from "../PredictRunner";
import { toPredictOptions } from "../toPredictOptions";

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
}));

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
      landedSince: () => Promise.resolve([]),
      hasPending: () => Promise.resolve(false),
      nextNonce: () => Promise.resolve(0),
      sentWithNonce: () => Promise.resolve({ status: "none" as const }),
      optionStates: ({ options }: { options: PredictOption[] }) => {
        chain.asked.push(options.map((option) => option.targetPriceWad));
        return Promise.resolve(options.map(() => chainState()));
      },
    }),
  };
});

vi.mock("@/lib/swap/lens", async () => {
  const { fakeCreditsQuoter, fakeQuoter } = await import("@/features/predict/flow/__tests__/support/fakes");
  return { createLensQuoter: () => fakeQuoter(), createLensExactInputQuoter: () => fakeCreditsQuoter() };
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

/** The target prices an estimate stands for on this session's options. */
const targetsFor = (value: number) => {
  const detail = session();
  return toPredictOptions(detail, selectedAt(detail, value)).map((option) => option.targetPriceWad);
};

function connect(address: Address | undefined) {
  wallet.address = address;
  wallet.chainId = address === undefined ? undefined : gnosis.id;
}

function fill(values: { deposit: bigint; estimate: number }) {
  form.deposit = values.deposit;
  form.estimate = values.estimate;
}

function renderRunner() {
  const detail = session();
  const selected = selectedAt(detail, form.estimate);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSuccess = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view: RenderResult = render(
    <PredictRunner session={detail} selected={selected} onClose={vi.fn()} onSuccess={onSuccess} />,
    { wrapper },
  );
  return { ...view, onSuccess };
}

const predictButton = () => screen.getByRole("button", { name: "Predict" });
const resumeButton = () => screen.getByRole("button", { name: /resume/i });

/** Lets a run that is not going to prompt finish whatever it does instead. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const isDeposit = (prompt: Prompt) => isAddressEqual(prompt.to, addresses.collateralToken);
const transferOf = (prompt: Prompt) => {
  const args = decodeFunctionData({ abi: erc20Abi, data: prompt.data as Hex }).args as readonly [Address, bigint];
  return { to: args[0].toLowerCase(), amount: args[1] };
};

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

/** A's deposit lands, A turns the prediction down and reloads. Returns the deposit's hash. */
async function leaveRejectedPredictionAfterDeposit() {
  const view = await firstVisit(["accept", "reject"]);
  await waitFor(() => expect(onScreen()).toContain("You declined in your wallet."));
  view.unmount();
  const deposit = chain.prompts.find(isDeposit)!;
  expect(chain.receipts.get(deposit.hash)).toBe("success");
  return deposit.hash;
}

/** A signs the deposit and reloads before it mines. Returns its hash. */
async function leaveSubmittedDeposit() {
  const view = await firstVisit([], { holdMining: true });
  await waitFor(() => expect(chain.prompts.some(isDeposit)).toBe(true));
  view.unmount();
  return chain.prompts.find(isDeposit)!.hash;
}

/** Reopens the popup with the current form, and lets anything that would start on its own start. */
async function reopen(values: { deposit: bigint; estimate: number } = CURRENT) {
  connect(A);
  fill(values);
  const before = chain.prompts.length;
  const view = renderRunner();
  await settle();
  return { ...view, before, since: () => chain.prompts.slice(before) };
}

/** Presses Predict if the reopened popup offers it at all. */
async function tryPredict() {
  const button = screen.queryByRole("button", { name: "Predict" });
  if (button) await userEvent.click(button).catch(() => undefined);
  await settle();
}

async function pressResume() {
  await waitFor(() => expect(resumeButton()).toBeEnabled());
  await userEvent.click(resumeButton());
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
  chain.deployed = true;
  connect(undefined);
  fill(CURRENT);
});

describe("reopening a saved run", () => {
  /** The saved run is open for review: its own amount is on screen. */
  const reviewShown = () => waitFor(() => expect(onScreen()).toContain("7.25"));

  it("opens the review and prompts nothing after a rejected deposit", async () => {
    await leaveRejectedDeposit();

    const { since } = await reopen();
    await reviewShown();
    await settle();

    expect(since()).toEqual([]);
  });

  it("opens the review and prompts nothing after a deposit that landed while the tab was closed", async () => {
    await leaveSubmittedDeposit();
    mine();

    const { since } = await reopen();
    await reviewShown();
    await settle();

    expect(since()).toEqual([]);
  });

  it("opens the review and prompts nothing when the deposit still in flight mines during it", async () => {
    await leaveSubmittedDeposit();

    const { since } = await reopen();
    await reviewShown();
    mine();
    await settle();

    expect(since()).toEqual([]);
  });
});

describe("the recovery screen", () => {
  it("shows the saved deposit, not the amount in the form", async () => {
    await leaveRejectedDeposit();

    await reopen();

    await waitFor(() => expect(onScreen()).toContain("7.25"));
  });

  it("shows the saved estimate, not the one in the form", async () => {
    await leaveRejectedDeposit();

    await reopen();

    await waitFor(() => expect(onScreen()).toContain("410 $M"));
  });

  it("lists the markets as they stand, not the form's preview, whose deposit differs from the saved one", async () => {
    await leaveRejectedDeposit();

    await reopen();
    await waitFor(() => expect(onScreen()).toContain("7.25"));
    await userEvent.click(within(screen.getByTestId("predict-summary")).getByRole("button"));

    const moves = within(screen.getByTestId("predict-summary"))
      .getAllByTestId("market-move")
      .map((move) => move.textContent);
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) expect(move).toMatch(/^(Now |No preview)/);
  });

  it("shows the saved deposit and estimate after a submitted transaction", async () => {
    await leaveSubmittedDeposit();
    mine();

    await reopen();

    await waitFor(() => {
      expect(onScreen()).toContain("7.25");
      expect(onScreen()).toContain("410 $M");
    });
  });
});

describe("a form that differs from the saved run", () => {
  it("does not sign the saved deposit when Predict is pressed with another amount", async () => {
    await leaveRejectedDeposit();

    const { since } = await reopen({ deposit: CURRENT.deposit, estimate: SAVED.estimate });
    await tryPredict();

    expect(since()).toEqual([]);
  });

  it("does not sign the saved deposit when Predict is pressed with another estimate", async () => {
    await leaveRejectedDeposit();

    const { since } = await reopen({ deposit: SAVED.deposit, estimate: CURRENT.estimate });
    await tryPredict();

    expect(since()).toEqual([]);
  });

  it("does not sign the saved prediction when Predict is pressed after a landed deposit", async () => {
    await leaveRejectedPredictionAfterDeposit();

    const { since } = await reopen();
    await tryPredict();

    expect(since()).toEqual([]);
  });
});

describe("resuming", () => {
  it("signs the saved deposit into A's trade wallet only once Resume is pressed", async () => {
    await leaveRejectedDeposit();
    const { since } = await reopen();
    expect(since()).toEqual([]);

    await pressResume();

    await waitFor(() => expect(since().length).toBeGreaterThan(0));
    const first = since()[0]!;
    expect(isDeposit(first)).toBe(true);
    expect(transferOf(first)).toEqual({ to: A_EXECUTOR, amount: SAVED.deposit });
    expect(
      since()
        .filter(isDeposit)
        .map((prompt) => transferOf(prompt).amount),
    ).not.toContain(CURRENT.deposit);
  });

  it("trades the saved estimates, not the form's", async () => {
    await leaveRejectedDeposit();
    const { onSuccess } = await reopen();
    chain.asked.length = 0;

    await pressResume();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(chain.asked.length).toBeGreaterThan(0);
    for (const targets of chain.asked) expect(targets).toEqual(targetsFor(SAVED.estimate));
    // what the stored run placed, not the form's amount
    expect(onSuccess.mock.calls[0]?.[1]).toMatchObject({ estimates: 1, amount: SAVED.deposit });
  });

  it("still waits for Resume after a deposit in flight mines during the review", async () => {
    const hash = await leaveSubmittedDeposit();

    const { since, onSuccess } = await reopen();
    mine();
    await settle();
    expect(chain.receipts.get(hash)).toBe("success");
    expect(since()).toEqual([]);

    await pressResume();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(since().filter(isDeposit)).toEqual([]);
  });
});

describe("completed transactions", () => {
  it("keeps a deposit that landed before the rejection, and does not sign it again on Resume", async () => {
    await leaveRejectedPredictionAfterDeposit();
    const { since, onSuccess } = await reopen();

    await pressResume();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(since().length).toBeGreaterThan(0);
    expect(since().filter(isDeposit)).toEqual([]);
  });

  it("keeps a deposit that landed while the tab was closed, and does not sign it again on Resume", async () => {
    await leaveSubmittedDeposit();
    mine();
    const { since, onSuccess } = await reopen();

    await pressResume();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(since().length).toBeGreaterThan(0);
    expect(since().filter(isDeposit)).toEqual([]);
  });
});

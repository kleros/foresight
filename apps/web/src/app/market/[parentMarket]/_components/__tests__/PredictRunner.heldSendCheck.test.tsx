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
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PredictOption } from "@/features/predict/flow/types";
import type { SelectedEstimate } from "@/features/predict/types";
import type { SessionDetail, SessionStatus } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { addresses, GATEWAY } from "@/testing/fixtures";

import { PredictRunner } from "../PredictRunner";

/** The popup over the real run: a held send past its hold can still be checked under resolved or unknown. */

/* Predictions run on gnosis only; the test environment would otherwise default to the local chain. */
vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_LOCAL_CHAIN", "false");
});

const WAD = 10n ** 18n;

const A = "0xa11ce000000000000000000000000000000a11ce" as Address;
const A_EXECUTOR = "0xa11ce000000000000000000000000000000e0e0a" as Address;

/** The form Predict is pressed with, and the form each test starts from. */
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
  /** Receipt waits block while this is set. */
  holdMining: false,
  waiting: [] as Array<() => void>,
  deployed: true,
  /** The target prices every build asked the chain about, in order. */
  asked: [] as bigint[][],
  /** The options the last build asked the chain about, which the quoter prices. */
  options: [] as PredictOption[],
  /** Pool reads block while this is set. */
  holdReads: false,
  readsWaiting: [] as Array<() => void>,
  /** Prompts the wallet answers with a coded error before broadcasting, by prompt index. */
  codedFailures: new Set<number>(),
  /** What the chain holds under each of the owner's nonces. */
  byNonce: [] as Array<{ hash: `0x${string}`; to: `0x${string}`; data?: `0x${string}` }>,
}));

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
        if (chain.codedFailures.has(chain.prompts.length - 1)) {
          throw new Error("Transaction failed", {
            cause: Object.assign(new Error("Internal JSON-RPC error."), { code: -32603 }),
          });
        }
        chain.byNonce.push({ hash, to: params.to, data: params.data });
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
      nextNonce: () => Promise.resolve(chain.byNonce.length),
      sentWithNonce: ({ nonce }: { nonce: number }) => {
        const sent = chain.byNonce[nonce];
        return Promise.resolve(
          sent
            ? {
                status: "mined" as const,
                hash: sent.hash,
                to: sent.to,
                value: 0n,
                input: sent.data ?? "0x",
                success: true,
              }
            : { status: "none" as const },
        );
      },
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
// a live preview for every estimate in the form; its plans are the fake chain's pools for the form's split, which a
// new run is held to
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

const button = (name: string) => screen.getByRole("button", { name });

/** Lets a run that is not going to prompt finish whatever it does instead. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const isDeposit = (prompt: Prompt) => isAddressEqual(prompt.to, addresses.collateralToken);

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
  chain.codedFailures.clear();
  chain.byNonce.length = 0;
  connect(undefined);
  fill(CURRENT);
});

afterEach(() => {
  vi.useRealTimers();
});

/** A presses Predict; the wallet answers the deposit with a coded error and broadcasts nothing; ten minutes pass. */
async function heldPastItsHold() {
  vi.useFakeTimers({ toFake: ["Date"] });
  connect(A);
  fill(SAVED);
  chain.codedFailures.add(0);
  const view = renderRunner();
  await waitFor(() => expect(button("Predict")).toBeEnabled());
  await userEvent.click(button("Predict"));
  await waitFor(() => expect(button("Check again")).toBeEnabled());
  vi.setSystemTime(Date.now() + 600_001);
  await userEvent.click(button("Check again"));
  await waitFor(() => expect(button("Sign again")).toBeEnabled());
  return view;
}

describe.each(["resolved", "unknown"] as const)("A8 a held send past its hold, under status %s", (status) => {
  it("offers Check again in place of Sign again, which signs nothing", async () => {
    const view = await heldPastItsHold();
    const sent = chain.prompts.length;

    view.rerenderAt(status);
    expect(screen.queryByRole("button", { name: "Sign again" })).toBeNull();
    await userEvent.click(button("Check again"));
    await settle();

    expect(chain.prompts).toHaveLength(sent);
    await waitFor(() => expect(button("Check again")).toBeEnabled());
  });

  it("takes up the deposit once it mined late, and sends nothing after it", async () => {
    const view = await heldPastItsHold();
    const deposit = chain.prompts.find(isDeposit)!;
    const sent = chain.prompts.length;

    view.rerenderAt(status);
    chain.byNonce.push({ hash: deposit.hash, to: deposit.to, data: deposit.data });
    await userEvent.click(button("Check again"));
    await settle();
    await settle();

    expect(chain.prompts).toHaveLength(sent);
    // the held send is settled, so nothing is left to check and the rest waits for the session to trade
    await waitFor(() => expect(button("Try the rest")).toBeDisabled());
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
  });
});

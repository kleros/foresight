import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PredictOption } from "@/features/predict/flow/types";
import type { SelectedEstimate } from "@/features/predict/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { addresses, GATEWAY } from "@/testing/fixtures";

import { PredictCard } from "../PredictCard";
import { PredictRunner } from "../PredictRunner";
import { toPredictOptions } from "../toPredictOptions";

/* Predictions run on gnosis only; the test environment would otherwise default to the local chain. */
vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_LOCAL_CHAIN", "false");
});

const A = "0xa11ce000000000000000000000000000000a11ce" as Address;
const A_EXECUTOR = "0xa11ce000000000000000000000000000000e0e0a" as Address;
const B = "0xb0b00000000000000000000000000000000000b0" as Address;

/** What the visit before the reload put in. */
const SAVED = { deposit: 725n * 10n ** 16n, estimate: 410 } as const;

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
      optionStates: ({ options }: { options: PredictOption[] }) => {
        chain.asked.push(options.map((option) => option.targetPriceWad));
        return Promise.resolve(options.map(() => chainState()));
      },
    }),
  };
});

vi.mock("@/lib/swap/lens", async () => {
  const { fakeQuoter } = await import("@/features/predict/flow/__tests__/support/fakes");
  return { createLensQuoter: () => fakeQuoter() };
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
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));
/* The real dialog reaches the Atlas provider, which only matters after the run is done. */
vi.mock("../PredictSuccessDialog", () => ({
  PredictSuccessDialog: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <p>Prediction done</p> : null),
}));

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

const targetsFor = (value: number) => {
  const detail = session();
  return toPredictOptions(detail, selectedAt(detail, value)).map((option) => option.targetPriceWad);
};

function connect(address: Address | undefined) {
  wallet.address = address;
  wallet.chainId = address === undefined ? undefined : gnosis.id;
}

const wrapperFor = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const isDeposit = (prompt: Prompt) => isAddressEqual(prompt.to, addresses.collateralToken);
const transferOf = (prompt: Prompt) => {
  const args = decodeFunctionData({ abi: erc20Abi, data: prompt.data as Hex }).args as readonly [Address, bigint];
  return { to: args[0].toLowerCase(), amount: args[1] };
};

/** The visit before the reload: A predicts through the popup with the saved amount and estimate. */
async function firstVisit(answers: Array<"accept" | "reject">, opts: { holdMining?: boolean } = {}) {
  connect(A);
  form.deposit = SAVED.deposit;
  form.estimate = SAVED.estimate;
  chain.answers.push(...answers);
  chain.holdMining = opts.holdMining ?? false;
  const detail = session();
  const view = render(
    <PredictRunner
      session={detail}
      selected={selectedAt(detail, SAVED.estimate)}
      onClose={vi.fn()}
      onSuccess={vi.fn()}
    />,
    { wrapper: wrapperFor() },
  );
  const predict = () => screen.getByRole("button", { name: "Predict" });
  await waitFor(() => expect(predict()).toBeEnabled());
  await userEvent.click(predict());
  return view;
}

/** A's deposit lands in the trade wallet, A turns the prediction down and reloads. */
async function leaveDepositLandedPredictionRejected() {
  const view = await firstVisit(["accept", "reject"]);
  await waitFor(() => expect(document.body.textContent).toContain("You declined in your wallet."));
  view.unmount();
  const deposit = chain.prompts.find(isDeposit)!;
  expect(transferOf(deposit)).toEqual({ to: A_EXECUTOR, amount: SAVED.deposit });
  expect(chain.receipts.get(deposit.hash)).toBe("success");
}

/** A signs the deposit and closes the tab before it mines; it lands while the tab is closed. */
async function leaveDepositLandedWhileClosed() {
  const view = await firstVisit([], { holdMining: true });
  await waitFor(() => expect(chain.prompts.some(isDeposit)).toBe(true));
  view.unmount();
  mine();
  await settle();
  expect(chain.receipts.get(chain.prompts.find(isDeposit)!.hash)).toBe("success");
}

/** The next visit: the market page's predict card, nothing selected and nothing pressed. */
async function nextVisit(address: Address = A) {
  connect(address);
  // the form behind the card is empty on a fresh visit
  form.deposit = 0n;
  form.estimate = 0;
  const before = chain.prompts.length;
  render(<PredictCard session={session()} status="trading" marketEstimates={{}} />, { wrapper: wrapperFor() });
  await settle();
  return { since: () => chain.prompts.slice(before) };
}

// PredictCard loads the success dialog with next/dynamic on first open; importing it here keeps
// its first load out of the first test's timeout.
beforeAll(async () => {
  await import("../PredictSuccessDialog");
});

const cardResume = () => screen.findByRole("button", { name: /resume/i });

/** Opens the run from the card's notice and continues it from wherever that leads. */
async function resumeFromCard() {
  await userEvent.click(await cardResume());
  await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  const inDialog = within(screen.getByRole("dialog"));
  const resume = inDialog.queryByRole("button", { name: /resume/i });
  if (resume) {
    await waitFor(() => expect(resume).toBeEnabled());
    await userEvent.click(resume);
  }
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
});

describe("an interrupted run on the next visit", () => {
  const interrupted = [
    ["the deposit landed and the prediction was turned down", leaveDepositLandedPredictionRejected],
    ["the deposit landed after the tab was closed", leaveDepositLandedWhileClosed],
  ] as const;

  describe.each(interrupted)("when %s", (_name, leave) => {
    it("is surfaced on the card, with its parked deposit, before anything is pressed", async () => {
      await leave();

      const { since } = await nextVisit();

      expect(await cardResume()).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.body.textContent).toContain("7.25");
      expect(since()).toEqual([]);
    });

    it("finishes the saved prediction from the card's Resume without signing the deposit again", async () => {
      await leave();
      const { since } = await nextVisit();
      chain.asked.length = 0;

      await resumeFromCard();

      await waitFor(() => expect(screen.getByText("Prediction done")).toBeInTheDocument());
      expect(since().length).toBeGreaterThan(0);
      expect(since().filter(isDeposit)).toEqual([]);
      expect(chain.asked.length).toBeGreaterThan(0);
      for (const targets of chain.asked) expect(targets).toEqual(targetsFor(SAVED.estimate));
    });
  });

  it("is not surfaced when no run was left unfinished", async () => {
    await nextVisit();

    expect(screen.queryByRole("button", { name: /resume/i })).toBeNull();
  });

  it("is not surfaced to another wallet", async () => {
    await leaveDepositLandedPredictionRejected();

    await nextVisit(B);

    expect(screen.queryByRole("button", { name: /resume/i })).toBeNull();
  });
});

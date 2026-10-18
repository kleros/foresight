import type { ComponentProps, ReactNode } from "react";

import {
  createFlowRunStore,
  createMemoryStorage,
  type FlowRunStore,
  type FlowTx,
  type TxGateway,
} from "@foresight/tx-orchestrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { WaitForTransactionReceiptTimeoutError, type Address, type Hash, type TransactionReceipt } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccount } from "wagmi";

import type { PredictDialog } from "@/features/predict/components/PredictDialog";
import { addresses, ctx, fakeQuoter, fakeReader, snapshot, WAD } from "@/features/predict/flow/__tests__/support/fakes";
import { STEP_ID } from "@/features/predict/flow/plan";
import type { PredictCtx, PredictSnapshot } from "@/features/predict/flow/types";
import { createPredictRun } from "@/features/predict/run/driver";
import type { PredictDriver } from "@/features/predict/run/types";
import type { SelectedEstimate } from "@/features/predict/types";
import type { SessionDetail } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { GATEWAY } from "@/testing/fixtures";

import { PredictRunner } from "../PredictRunner";

const OWNER = "0x9999999999999999999999999999999999999999" as Address;
const EXECUTOR = "0x8888888888888888888888888888888888888888" as Address;

/** The run the mocked hook hands the runner; set per mount. */
const harness = vi.hoisted(() => ({ makeDriver: null as null | (() => PredictDriver) }));

vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://cdn.example.link/ipfs" }));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: vi.fn(),
}));

vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  gnosisRouterAddress: () => "0x7777777777777777777777777777777777777777",
  tradeExecutorFactoryAddress: () => "0x6666666666666666666666666666666666666666",
}));

// The real driver over a scripted chain, held and disposed the way the real hook does.
vi.mock("@/features/predict/hooks/usePredictRun", async () => {
  const React = await import("react");
  return {
    usePredictRun: () => {
      const driver = React.useMemo(() => harness.makeDriver!(), []);
      React.useEffect(() => () => driver.dispose(), [driver]);
      const progress = React.useSyncExternalStore(driver.subscribe, driver.getProgress, driver.getProgress);
      return { driver, progress };
    },
  };
});

vi.mock("@/features/trade-executor/api/getExecutor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/trade-executor/api/getExecutor")>()),
  useExecutor: () => ({ data: { predicted: EXECUTOR, deployed: true } }),
}));

vi.mock("../usePredictFunding", () => ({
  usePredictFunding: () => ({ funding: null, credits: { state: "none" }, canPayNative: false, isPending: false }),
}));

vi.mock("../useHasPredicted", () => ({ useHasPredicted: () => false }));

type DialogProps = ComponentProps<typeof PredictDialog>;

// Exposes what the popup would show: its failure line and the three timeline rows.
vi.mock("@/features/predict/components/PredictDialog", () => ({
  PredictDialog: (props: DialogProps) => (
    <div>
      <p data-testid="running">{String(props.isRunning)}</p>
      <p data-testid="failure">{props.steps.failure ?? ""}</p>
      <ul>
        {props.steps.rows.map((row) => (
          <li key={row.key} data-testid="row">{`${row.key}|${row.view}|${row.title}|${row.subtitle}`}</li>
        ))}
      </ul>
      <button onClick={props.onClose}>close</button>
      <button onClick={props.onPredict}>predict</button>
    </div>
  ),
}));

const FLOW_ID = "predict-pending-test";
const START_BALANCE = WAD * 2n;
const DEPOSIT = WAD * 3n;
const SNAP = snapshot({ deposit: DEPOSIT, collateralIn: WAD * 5n, collateralBefore: START_BALANCE });

/** What happens to the nth transaction the wallet signs. Default: it mines. */
type Script = "mine" | "revert" | "hold" | "hold-and-network-down";

/**
 * A wallet, a chain and an RPC. While the network is down every read and every receipt
 * wait fails, but transactions already broadcast stay out there and can still mine.
 */
function fakeChain(scripts: Script[] = []) {
  const signRequests: FlowTx[] = [];
  const mined = new Map<Hash, "success" | "reverted">();
  const known = new Set<Hash>();
  const deposits = new Set<Hash>();
  const waitedOn: Hash[] = [];
  const failed = { waits: 0, reads: 0 };
  let networkDown = false;
  let collateral = START_BALANCE;

  const receipt = (hash: Hash, status: "success" | "reverted") =>
    ({ transactionHash: hash, status, blockNumber: 19_000_000n }) as TransactionReceipt;

  function mine(hash: Hash, status: "success" | "reverted" = "success") {
    mined.set(hash, status);
    if (status === "success" && deposits.has(hash)) collateral += DEPOSIT;
  }

  function down(): void {
    failed.reads++;
    throw new Error("RPC unavailable");
  }

  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      const index = signRequests.length;
      signRequests.push(tx);
      const hash = `0x${(0xd0 + index).toString(16).padStart(64, "0")}` as Hash;
      known.add(hash);
      if (isDeposit(tx)) deposits.add(hash);
      const script = scripts[index] ?? "mine";
      if (script === "mine") mine(hash);
      if (script === "revert") mine(hash, "reverted");
      if (script === "hold-and-network-down") networkDown = true;
      return Promise.resolve(hash);
    },
    waitForReceipt: async ({ hash, signal }) => {
      waitedOn.push(hash);
      for (;;) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (networkDown) {
          failed.waits++;
          throw new WaitForTransactionReceiptTimeoutError({ hash });
        }
        const status = mined.get(hash);
        if (status) return receipt(hash, status);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
    getReceipt: async (hash) => {
      if (networkDown) down();
      const status = mined.get(hash);
      return status ? receipt(hash, status) : null;
    },
    isKnown: async (hash) => {
      if (networkDown) down();
      return known.has(hash);
    },
  };

  const reader = {
    ...fakeReader({ deployed: true }),
    collateralBalance: async () => {
      if (networkDown) down();
      return collateral;
    },
  };

  return {
    gateway,
    reader,
    signRequests,
    waitedOn,
    failed,
    deposits: () => signRequests.filter(isDeposit),
    sent: (index: number) => `0x${(0xd0 + index).toString(16).padStart(64, "0")}` as Hash,
    /** A hash broadcast before this test's wallet existed, still in the mempool. */
    seedPending(hash: Hash, deposit: boolean) {
      known.add(hash);
      if (deposit) deposits.add(hash);
    },
    mine,
    setNetworkDown(value: boolean) {
      networkDown = value;
    },
  };
}

type Chain = ReturnType<typeof fakeChain>;

/** A collateral transfer or an xDAI payment to the adapter: money into the trade wallet. */
const isDeposit = (tx: FlowTx) => tx.to === addresses.collateral || tx.to === addresses.sDaiAdapter;

const accountMock = vi.mocked(useAccount);

const session = (): SessionDetail =>
  toSessionDetail({ ...sessionDetailColumns, children: [sessionChildRow()] }, GATEWAY);

const selectedOn = (detail: SessionDetail): SelectedEstimate[] => [
  { scale: detail.options[0]!, value: 312, marketEstimate: 250, direction: "higher" },
];

/** Opens the popup on a fresh driver over `chain` and `store`, as pressing the predict button does. */
function open(chain: Chain, store: FlowRunStore, reader = chain.reader) {
  harness.makeDriver = () =>
    createPredictRun({
      gateway: chain.gateway,
      reader,
      quoter: fakeQuoter(),
      store,
      flowId: FLOW_ID,
      ctx: (): PredictCtx => ctx(),
      snapshot: (): PredictSnapshot => SNAP,
    });

  const detail = session();
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  );
  const view = render(
    <PredictRunner session={detail} selected={selectedOn(detail)} onClose={onClose} onSuccess={onSuccess} />,
    { wrapper },
  );

  return {
    onClose,
    onSuccess,
    predict: () => fireEvent.click(screen.getByText("predict")),
    /** Close pressed, then the page unmounts the popup. */
    close: () => {
      fireEvent.click(screen.getByText("close"));
      view.unmount();
    },
    shown: () => [
      screen.getByTestId("failure").textContent,
      ...screen.getAllByTestId("row").map((row) => row.textContent),
    ],
  };
}

const running = () => screen.getByTestId("running").textContent === "true";

const SLOW = { timeout: 10_000 };

/** The watcher retries a timed-out receipt wait with back-off before the run stops. */
async function untilReceiptWaitsGiveUp(chain: Chain) {
  await vi.waitFor(() => {
    expect(chain.failed.waits).toBeGreaterThan(0);
    expect(running()).toBe(false);
  }, SLOW);
  await act(async () => {});
}

async function untilRecoveryReadFails(chain: Chain) {
  await vi.waitFor(() => {
    expect(chain.failed.reads).toBeGreaterThan(0);
    expect(running()).toBe(false);
  }, SLOW);
  await act(async () => {});
}

const stepOutcome = (store: FlowRunStore, stepId: string) =>
  store.load<PredictSnapshot, PredictCtx>(FLOW_ID)?.steps.find((step) => step.stepId === stepId)?.outcome;

/** A run left by an earlier popup: its deposit broadcast and not yet mined. */
function seedSubmittedDeposit(chain: Chain, store: FlowRunStore): Hash {
  const hash = `0x${"1".repeat(64)}` as Hash;
  chain.seedPending(hash, true);
  store.save<PredictSnapshot, PredictCtx>({
    flowId: FLOW_ID,
    adapterId: "predict-flow",
    status: "paused",
    reason: "error",
    ctx: ctx(),
    snapshot: { ...SNAP, collateralAtStart: START_BALANCE },
    steps: [
      { stepId: STEP_ID.createExecutor, label: "Set up your trade wallet", outcome: { status: "skipped" } },
      { stepId: STEP_ID.deposit, label: "Add money to your trade wallet", outcome: { status: "submitted", hash } },
      { stepId: STEP_ID.predict(1), label: "Making your prediction", outcome: { status: "pending" } },
    ],
  });
  return hash;
}

/** Reopens, resumes once the stored run is up for review, then waits until it reuses `hash` or signs a fresh deposit. */
async function reopenAndPredict(chain: Chain, store: FlowRunStore, hash: Hash, depositsBefore: number) {
  const waitedBefore = chain.waitedOn.length;
  const popup = open(chain, store);
  await vi.waitFor(() => expect(running()).toBe(false));
  popup.predict();
  await vi.waitFor(() => {
    const reused = chain.waitedOn.slice(waitedBefore).includes(hash) || popup.onSuccess.mock.calls.length > 0;
    const resigned = chain.deposits().length > depositsBefore;
    expect(reused || resigned).toBe(true);
  }, SLOW);
  return popup;
}

let store: FlowRunStore;

beforeEach(() => {
  vi.clearAllMocks();
  accountMock.mockReturnValue({ address: OWNER, chainId: DEFAULT_CHAIN_ID } as ReturnType<typeof useAccount>);
  store = createFlowRunStore({ storage: createMemoryStorage() });
});

afterEach(() => {
  harness.makeDriver = null;
});

describe("PredictRunner, closing a run whose transaction may still be pending", () => {
  it.each([
    ["the deposit", ["hold-and-network-down"] as Script[], STEP_ID.deposit, 0],
    ["a prediction batch", ["mine", "hold-and-network-down"] as Script[], STEP_ID.predict(1), 1],
  ])(
    "keeps the hash and the snapshot when %s timed out waiting for its receipt",
    async (_, scripts, stepId, sentIndex) => {
      const chain = fakeChain(scripts);
      const popup = open(chain, store);
      popup.predict();
      await untilReceiptWaitsGiveUp(chain);

      const hash = chain.sent(sentIndex);
      expect(stepOutcome(store, stepId)).toEqual({ status: "submitted", hash });
      const before = store.load<PredictSnapshot, PredictCtx>(FLOW_ID)!.snapshot;

      popup.close();

      expect(popup.onClose).toHaveBeenCalledTimes(1);
      expect(stepOutcome(store, stepId)).toEqual({ status: "submitted", hash });
      expect(store.load<PredictSnapshot, PredictCtx>(FLOW_ID)?.snapshot).toEqual(before);
    },
    15_000,
  );

  it("keeps the hash and the snapshot when the recovery read failed", async () => {
    const chain = fakeChain();
    const hash = seedSubmittedDeposit(chain, store);
    const before = store.load<PredictSnapshot, PredictCtx>(FLOW_ID)!.snapshot;
    chain.setNetworkDown(true);

    const popup = open(chain, store);
    popup.predict();
    await untilRecoveryReadFails(chain);
    popup.close();

    expect(stepOutcome(store, STEP_ID.deposit)).toEqual({ status: "submitted", hash });
    expect(store.load<PredictSnapshot, PredictCtx>(FLOW_ID)?.snapshot).toEqual(before);
  });
});

describe("PredictRunner, reopening after closing on a pending transaction", () => {
  it("waits on the deposit already broadcast instead of asking for it again", async () => {
    const chain = fakeChain(["hold-and-network-down"]);
    const first = open(chain, store);
    first.predict();
    await untilReceiptWaitsGiveUp(chain);
    const hash = chain.sent(0);
    first.close();

    chain.setNetworkDown(false);
    const second = await reopenAndPredict(chain, store, hash, 1);

    expect(chain.deposits()).toHaveLength(1);

    chain.mine(hash);
    await vi.waitFor(() => expect(second.onSuccess).toHaveBeenCalled(), SLOW);
    expect(chain.deposits()).toHaveLength(1);
    expect(chain.signRequests.length).toBeGreaterThan(1);
  }, 20_000);

  it("waits on the deposit already broadcast after a failed recovery read", async () => {
    const chain = fakeChain();
    const hash = seedSubmittedDeposit(chain, store);
    chain.setNetworkDown(true);
    const first = open(chain, store);
    first.predict();
    await untilRecoveryReadFails(chain);
    first.close();

    chain.setNetworkDown(false);
    const second = await reopenAndPredict(chain, store, hash, 0);

    expect(chain.deposits()).toEqual([]);

    chain.mine(hash);
    await vi.waitFor(() => expect(second.onSuccess).toHaveBeenCalled(), SLOW);
    expect(chain.deposits()).toEqual([]);
  }, 20_000);
});

describe("PredictRunner, a transaction that confirms while the popup is closed", () => {
  it("carries on to the prediction after a receipt timeout, without a second deposit", async () => {
    const chain = fakeChain(["hold-and-network-down"]);
    const first = open(chain, store);
    first.predict();
    await untilReceiptWaitsGiveUp(chain);
    const hash = chain.sent(0);
    first.close();

    chain.setNetworkDown(false);
    chain.mine(hash);

    const second = await reopenAndPredict(chain, store, hash, 1);
    await vi.waitFor(() => expect(second.onSuccess).toHaveBeenCalled(), SLOW);

    expect(chain.deposits()).toHaveLength(1);
    expect(chain.signRequests.filter((tx) => tx.to === addresses.executor)).toHaveLength(1);
    expect(store.load(FLOW_ID)).toBeNull();
  }, 20_000);

  it("carries on to the prediction after a failed recovery read, without a second deposit", async () => {
    const chain = fakeChain();
    const hash = seedSubmittedDeposit(chain, store);
    chain.setNetworkDown(true);
    const first = open(chain, store);
    first.predict();
    await untilRecoveryReadFails(chain);
    first.close();

    chain.setNetworkDown(false);
    chain.mine(hash);

    const second = await reopenAndPredict(chain, store, hash, 0);
    await vi.waitFor(() => expect(second.onSuccess).toHaveBeenCalled(), SLOW);

    expect(chain.deposits()).toEqual([]);
    expect(chain.signRequests.filter((tx) => tx.to === addresses.executor)).toHaveLength(1);
    expect(store.load(FLOW_ID)).toBeNull();
  }, 20_000);
});

describe("PredictRunner, what the popup says about an outcome it does not know", () => {
  /** The same failure before anything was signed: nothing is out there to wait for. */
  async function shownWithNothingSent(error: () => Error) {
    const chain = fakeChain();
    const reader = { ...chain.reader, collateralBalance: () => Promise.reject(error()) };
    const popup = open(chain, store, reader);
    popup.predict();
    await vi.waitFor(() => expect(screen.getByTestId("failure")).not.toBeEmptyDOMElement(), SLOW);
    const shown = popup.shown();
    popup.close();
    store = createFlowRunStore({ storage: createMemoryStorage() });
    return shown;
  }

  async function shownForRevertedDeposit() {
    const chain = fakeChain(["revert"]);
    const popup = open(chain, store);
    popup.predict();
    await vi.waitFor(() => expect(screen.getByTestId("failure")).not.toBeEmptyDOMElement(), SLOW);
    const shown = popup.shown();
    popup.close();
    store = createFlowRunStore({ storage: createMemoryStorage() });
    return shown;
  }

  it("reads differently for a deposit whose receipt timed out than for a revert or nothing sent", async () => {
    const reverted = await shownForRevertedDeposit();
    const nothingSent = await shownWithNothingSent(
      () => new WaitForTransactionReceiptTimeoutError({ hash: `0x${"2".repeat(64)}` }),
    );

    const chain = fakeChain(["hold-and-network-down"]);
    const popup = open(chain, store);
    popup.predict();
    await untilReceiptWaitsGiveUp(chain);
    const pending = popup.shown();

    expect(pending).not.toEqual(reverted);
    expect(pending).not.toEqual(nothingSent);
    popup.close();
  }, 20_000);

  it("reads differently for a deposit whose recovery read failed than for a revert or nothing sent", async () => {
    const reverted = await shownForRevertedDeposit();
    const nothingSent = await shownWithNothingSent(() => new Error("RPC unavailable"));

    const chain = fakeChain();
    seedSubmittedDeposit(chain, store);
    chain.setNetworkDown(true);
    const popup = open(chain, store);
    popup.predict();
    await untilRecoveryReadFails(chain);
    const pending = popup.shown();

    expect(pending).not.toEqual(reverted);
    expect(pending).not.toEqual(nothingSent);
    popup.close();
  }, 20_000);
});

describe("PredictRunner, clearing a run that finished", () => {
  it("clears the stored run once every step has confirmed", async () => {
    const chain = fakeChain();
    const popup = open(chain, store);
    popup.predict();
    await vi.waitFor(() => expect(popup.onSuccess).toHaveBeenCalled(), SLOW);

    expect(store.load(FLOW_ID)).toBeNull();
    popup.close();
  });

  it("lets the next prediction start fresh after a finished run was cleared", async () => {
    const chain = fakeChain();
    const first = open(chain, store);
    first.predict();
    await vi.waitFor(() => expect(first.onSuccess).toHaveBeenCalled(), SLOW);
    first.close();

    const second = open(chain, store);
    second.predict();
    await vi.waitFor(() => expect(second.onSuccess).toHaveBeenCalled(), SLOW);

    expect(chain.deposits()).toHaveLength(2);
    second.close();
  });
});

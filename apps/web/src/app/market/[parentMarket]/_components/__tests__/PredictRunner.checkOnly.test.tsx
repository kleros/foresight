import type { ComponentProps, ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAccount } from "wagmi";

import type { PredictDialog } from "@/features/predict/components/PredictDialog";
import { snapshot } from "@/features/predict/flow/__tests__/support/fakes";
import { usePredictRun } from "@/features/predict/hooks/usePredictRun";
import type { PredictDriver, PredictProgress, PredictStage } from "@/features/predict/run/types";
import type { PayToken, SelectedEstimate } from "@/features/predict/types";
import type { SessionDetail, SessionStatus } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail, type SessionDetailRow } from "@/features/sessions/utils/toSessionDetail";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { GATEWAY } from "@/testing/fixtures";

import { PredictRunner } from "../PredictRunner";
import { usePredictFunding } from "../usePredictFunding";

const OWNER = "0x9999999999999999999999999999999999999999" as Address;
const EXECUTOR = "0x8888888888888888888888888888888888888888" as Address;

vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
/* The factory cannot reference imports, so GATEWAY's value is restated. */
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://cdn.example.link/ipfs" }));

/* The balance and executor reads would build an RPC client from env this suite does not supply. */
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: vi.fn(),
}));

// The test chain has no Seer router; the runner needs one to be ready at all.
vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  gnosisRouterAddress: () => "0x7777777777777777777777777777777777777777",
  tradeExecutorFactoryAddress: () => "0x6666666666666666666666666666666666666666",
}));

vi.mock("@/features/predict/hooks/usePredictRun", () => ({ usePredictRun: vi.fn() }));

vi.mock("@/features/trade-executor/api/getExecutor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/trade-executor/api/getExecutor")>()),
  useExecutor: () => executorRead,
}));

vi.mock("../usePredictFunding", () => ({ usePredictFunding: vi.fn() }));

vi.mock("../useHasPredicted", () => ({ useHasPredicted: () => false }));
// the credits swap is quoted on a chain with a credits route, which this one lacks
vi.mock("../useCreditsSwapPreview", () => ({ useCreditsSwapPreview: () => ({ failed: false }) }));

type DialogProps = ComponentProps<typeof PredictDialog>;

// The dialog is the runner's whole output; this stand-in exposes the props it was bound to.
vi.mock("@/features/predict/components/PredictDialog", () => ({
  PredictDialog: (props: DialogProps) => (
    <div>
      <p data-testid="notice">{props.notice ?? ""}</p>
      <p data-testid="running">{String(props.isRunning)}</p>
      <p data-testid="can-retry">{String(props.canRetry)}</p>
      <p data-testid="funds">{props.steps.rows.find((row) => row.key === "funds")?.subtitle}</p>
      <p data-testid="recovered-deposited">{props.recovered?.deposited?.toString() ?? "none"}</p>
      <p data-testid="token">{props.token.symbol}</p>
      <p data-testid="listed">{props.selected.length}</p>
      <button onClick={() => props.onRemove(props.selected[0]!.scale.market)}>remove</button>
      <p data-testid="amount">{props.amount?.toString()}</p>
      <button onClick={() => props.onAmountChange(10n * 10n ** 18n)}>pay ten</button>
      <button onClick={() => props.onTokenChange("native")}>pay in xDAI</button>
      <button onClick={props.onClose}>close</button>
      <button onClick={props.onPredict}>predict</button>
      <p data-testid="credits">{props.credits ? String(props.credits.isUsing) : "absent"}</p>
      <button onClick={() => props.credits?.onUsingChange(true)}>tick credits</button>
      <button onClick={() => props.credits?.onUsingChange(false)}>untick credits</button>
    </div>
  ),
}));

const accountMock = vi.mocked(useAccount);
const runMock = vi.mocked(usePredictRun);
const fundingMock = vi.mocked(usePredictFunding);

/** The token the balances would default to when the visitor has not picked one. */
let heldMore: PayToken | undefined;
let nativeAvailable: bigint | undefined;

const progressAt = (stage: PredictStage, retryable = false, steps: PredictProgress["steps"] = []): PredictProgress => ({
  stage,
  steps,
  leftOut: [],
  batchesDone: 0,
  batches: 0,
  ...(stage === "halted" ? { failure: { reason: retryable ? "rpc" : "reverted", retryable } } : {}),
});

const driver = {
  start: vi.fn<PredictDriver["start"]>(),
  recover: vi.fn<PredictDriver["recover"]>(),
  resume: vi.fn<PredictDriver["resume"]>(),
  confirm: vi.fn<PredictDriver["confirm"]>(),
  retry: vi.fn<PredictDriver["retry"]>(),
  discard: vi.fn<PredictDriver["discard"]>(),
  reset: vi.fn<PredictDriver["reset"]>(),
  dispose: vi.fn<PredictDriver["dispose"]>(),
  subscribe: vi.fn<PredictDriver["subscribe"]>(() => () => {}),
  getProgress: vi.fn<PredictDriver["getProgress"]>(() => progressAt("idle")),
} satisfies PredictDriver;

let executorRead: { data?: { predicted: Address; deployed: boolean }; error?: Error } = {};
let progress: PredictProgress | null = null;

const session = (overrides: Partial<SessionDetailRow> = {}): SessionDetail =>
  toSessionDetail({ ...sessionDetailColumns, ...overrides, children: [sessionChildRow()] }, GATEWAY);

const selectedOn = (detail: SessionDetail, value: number): SelectedEstimate[] => [
  { scale: detail.options[0]!, value, marketEstimate: 250, direction: "higher" },
];

function mount(detail: SessionDetail = session(), status: SessionStatus = "trading") {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const ui = (at: SessionStatus = status) => (
    <PredictRunner
      session={detail}
      status={at}
      selected={selectedOn(detail, 312)}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
  const view = render(ui(), { wrapper });
  const invalidatedKeys = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  return {
    ...view,
    rerenderAt: (at?: SessionStatus) => view.rerender(ui(at)),
    invalidatedKeys,
    onClose,
    onSuccess,
    queryClient,
  };
}

// The runner reads only the address and chain off the account.
const account = (address: Address | undefined, chainId: number | undefined) =>
  accountMock.mockReturnValue({ address, chainId } as ReturnType<typeof useAccount>);
const connected = (chainId: number = DEFAULT_CHAIN_ID) => account(OWNER, chainId);

beforeEach(() => {
  vi.clearAllMocks();
  executorRead = { data: { predicted: EXECUTOR, deployed: true } };
  progress = null;
  connected();
  heldMore = undefined;
  nativeAvailable = undefined;
  fundingMock.mockImplementation(({ token }) => ({
    funding: null,
    credits: { state: "none" },
    token: token ?? heldMore,
    available: (choice) => (choice === "native" ? nativeAvailable : undefined),
    canPayNative: true,
  }));
  runMock.mockImplementation(() => ({ driver, progress }));
});

const HASH = `0x${"a".repeat(64)}` as const;

/** A run stopped with a sent transaction whose receipt is not read yet. */
const awaitingReceipt = (reason: "rpc" | "resign" = "rpc"): PredictProgress => ({
  ...progressAt("halted", true),
  failure: { reason, retryable: true },
  pendingHash: HASH,
});

describe("Check again on a sent transaction", () => {
  it.each(["trading", "resolved", "unknown"] as const)("reads it under %s", (status) => {
    progress = awaitingReceipt();
    mount(session(), status);

    fireEvent.click(screen.getByText("predict"));

    expect(driver.retry).toHaveBeenCalledTimes(1);
    expect(driver.start).not.toHaveBeenCalled();
  });

  it("stays off under closed, whose run has no send gate", () => {
    progress = awaitingReceipt();
    mount(session(), "closed");

    fireEvent.click(screen.getByText("predict"));

    expect(driver.retry).not.toHaveBeenCalled();
    expect(driver.start).not.toHaveBeenCalled();
  });

  it.each(["resolved", "unknown"] as const)("does not sign a step again under %s", (status) => {
    progress = awaitingReceipt("resign");
    mount(session(), status);

    fireEvent.click(screen.getByText("predict"));

    expect(driver.retry).not.toHaveBeenCalled();
    expect(driver.start).not.toHaveBeenCalled();
  });
});

describe("Resume on a stored run under review", () => {
  const reviewing = (sent: Partial<PredictProgress>): PredictProgress => ({
    ...progressAt("review"),
    recovered: snapshot(),
    ...sent,
  });

  it.each([
    ["trading", { pendingHash: HASH }],
    ["resolved", { pendingHash: HASH }],
    ["unknown", { pendingHash: HASH }],
    ["resolved", { unanswered: true as const }],
    ["unknown", { unanswered: true as const }],
  ] as const)("reads the sent transaction under %s", (status, sent) => {
    progress = reviewing(sent);
    mount(session(), status);

    fireEvent.click(screen.getByText("predict"));

    expect(driver.resume).toHaveBeenCalledTimes(1);
    expect(driver.start).not.toHaveBeenCalled();
  });

  it.each(["resolved", "unknown"] as const)("does nothing under %s when no transaction awaits an answer", (status) => {
    progress = reviewing({});
    mount(session(), status);

    fireEvent.click(screen.getByText("predict"));

    expect(driver.resume).not.toHaveBeenCalled();
    expect(driver.retry).not.toHaveBeenCalled();
    expect(driver.start).not.toHaveBeenCalled();
  });
});

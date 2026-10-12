import type { ComponentProps, ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAccount } from "wagmi";

import type { PredictDialog } from "@/features/predict/components/PredictDialog";
import { snapshot } from "@/features/predict/flow/__tests__/support/fakes";
import { usePredictRun, type PredictRunInput } from "@/features/predict/hooks/usePredictRun";
import type { PredictDriver, PredictProgress, PredictStage } from "@/features/predict/run/types";
import type { SelectedEstimate } from "@/features/predict/types";
import { sessionChartKey } from "@/features/sessions/api/getSessionChart";
import type { SessionDetail } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail, type SessionDetailRow } from "@/features/sessions/utils/toSessionDetail";
import { executorKey } from "@/features/trade-executor/api/getExecutor";
import { fundsKeyPrefix } from "@/features/trade-executor/api/getFunds";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { addresses, GATEWAY } from "@/testing/fixtures";

import { PredictRunner } from "../PredictRunner";

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
  useExecutor: () => ({ data: { predicted: EXECUTOR, deployed: true } }),
}));

vi.mock("../usePredictFunding", () => ({
  usePredictFunding: () => ({ funding: null, canPayNative: false, isPending: false }),
}));

vi.mock("../useHasPredicted", () => ({ useHasPredicted: () => false }));

type DialogProps = ComponentProps<typeof PredictDialog>;

// The dialog is the runner's whole output; this stand-in exposes the props it was bound to.
vi.mock("@/features/predict/components/PredictDialog", () => ({
  PredictDialog: (props: DialogProps) => (
    <div>
      <p data-testid="notice">{props.notice ?? ""}</p>
      <p data-testid="running">{String(props.isRunning)}</p>
      <button onClick={props.onClose}>close</button>
      <button onClick={props.onPredict}>predict</button>
    </div>
  ),
}));

const accountMock = vi.mocked(useAccount);
const runMock = vi.mocked(usePredictRun);

const progressAt = (stage: PredictStage, retryable = false): PredictProgress => ({
  stage,
  steps: [],
  skipped: [],
  batchesDone: 0,
  batches: 0,
  ...(stage === "halted" ? { failure: { reason: retryable ? "rpc" : "reverted", retryable } } : {}),
});

const driver = {
  start: vi.fn<PredictDriver["start"]>(),
  recover: vi.fn<PredictDriver["recover"]>(),
  resume: vi.fn<PredictDriver["resume"]>(),
  retry: vi.fn<PredictDriver["retry"]>(),
  reset: vi.fn<PredictDriver["reset"]>(),
  dispose: vi.fn<PredictDriver["dispose"]>(),
  subscribe: vi.fn<PredictDriver["subscribe"]>(() => () => {}),
  getProgress: vi.fn<PredictDriver["getProgress"]>(() => progressAt("idle")),
} satisfies PredictDriver;

let progress: PredictProgress | null = null;
let lastInput: PredictRunInput | null = null;

const session = (overrides: Partial<SessionDetailRow> = {}): SessionDetail =>
  toSessionDetail({ ...sessionDetailColumns, ...overrides, children: [sessionChildRow()] }, GATEWAY);

const selectedOn = (detail: SessionDetail, value: number): SelectedEstimate[] => [
  { scale: detail.options[0]!, value, marketEstimate: 250, direction: "higher" },
];

function mount(detail: SessionDetail = session()) {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const ui = () => (
    <PredictRunner session={detail} selected={selectedOn(detail, 312)} onClose={onClose} onSuccess={onSuccess} />
  );
  const view = render(ui(), { wrapper });
  const invalidatedKeys = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  return { ...view, rerenderAt: () => view.rerender(ui()), invalidatedKeys, onClose, onSuccess };
}

// The runner reads only the address and chain off the account.
const account = (address: Address | undefined, chainId: number | undefined) =>
  accountMock.mockReturnValue({ address, chainId } as ReturnType<typeof useAccount>);
const connected = (chainId: number = DEFAULT_CHAIN_ID) => account(OWNER, chainId);

beforeEach(() => {
  vi.clearAllMocks();
  progress = null;
  lastInput = null;
  connected();
  runMock.mockImplementation((input) => {
    if (input) lastInput = input;
    return { driver, progress };
  });
});

describe("PredictRunner, what the visitor is told", () => {
  it("asks for a wallet when none is connected", () => {
    account(undefined, undefined);
    mount();

    expect(screen.getByTestId("notice")).toHaveTextContent("Connect a wallet to make this prediction.");
  });

  it("asks for Gnosis when the wallet is on another chain", () => {
    connected(DEFAULT_CHAIN_ID + 1);
    mount();

    expect(screen.getByTestId("notice")).toHaveTextContent("Switch to Gnosis to make this prediction.");
  });

  it("says the session cannot be traded when its collateral did not read", () => {
    mount(session({ collateralToken: null }));

    expect(screen.getByTestId("notice")).toHaveTextContent("This session cannot be traded yet.");
  });

  it("says nothing when the prediction can be made", () => {
    mount();

    expect(screen.getByTestId("notice")).toBeEmptyDOMElement();
  });

  it("drops the notice while a run is going", () => {
    connected(DEFAULT_CHAIN_ID + 1);
    progress = progressAt("signing");
    mount();

    expect(screen.getByTestId("running")).toHaveTextContent("true");
    expect(screen.getByTestId("notice")).toBeEmptyDOMElement();
  });
});

describe("PredictRunner, what it hands the run", () => {
  it("builds the run for the connected owner, the session and its executor", () => {
    const detail = session();
    mount(detail);

    expect(lastInput).toMatchObject({
      sessionId: detail.id,
      parentMarket: detail.parentMarket,
      collateral: addresses.collateralToken,
      owner: OWNER,
      executor: EXECUTOR,
    });
  });

  it("turns the selected estimate into the option the run trades", () => {
    mount();

    expect(lastInput?.options()).toEqual([
      {
        childMarket: addresses.childMarkets[0],
        underlying: addresses.underlyingToken,
        upToken: addresses.upToken,
        downToken: addresses.downToken,
        invalidToken: addresses.childInvalidToken,
        targetPriceWad: 624n * 10n ** 15n,
      },
    ]);
  });
});

describe("PredictRunner, refreshing what a run changed", () => {
  it("refreshes the balances, the trade wallet and the chart once a run completes", () => {
    const view = mount();
    lastInput?.onComplete?.();
    progress = progressAt("complete");
    view.rerenderAt();

    const keys = view.invalidatedKeys();
    expect(keys).toContainEqual([...fundsKeyPrefix]);
    expect(keys).toContainEqual([...executorKey(OWNER)]);
    expect(keys).toContainEqual([...sessionChartKey(session().id)]);
  });

  it("refreshes the balances and the trade wallet when a run stops partway", () => {
    progress = progressAt("halted");
    const view = mount();

    const keys = view.invalidatedKeys();
    expect(keys).toContainEqual([...fundsKeyPrefix]);
    expect(keys).toContainEqual([...executorKey(OWNER)]);
  });

  it("refreshes nothing before a run has done anything", () => {
    const view = mount();

    expect(view.invalidatedKeys()).toEqual([]);
  });
});

describe("PredictRunner, the dialog's controls", () => {
  it("hands off to the success dialog once the run completes", () => {
    progress = progressAt("complete");
    const view = mount();

    expect(view.onSuccess).toHaveBeenCalledTimes(1);
    expect(driver.reset).toHaveBeenCalled();
  });

  it("starts a run when predict is pressed", () => {
    mount();
    fireEvent.click(screen.getByText("predict"));

    expect(driver.start).toHaveBeenCalledTimes(1);
    expect(driver.retry).not.toHaveBeenCalled();
  });

  it("picks a retryable stopped run back up instead of starting over", () => {
    progress = progressAt("halted", true);
    mount();
    fireEvent.click(screen.getByText("predict"));

    expect(driver.retry).toHaveBeenCalledTimes(1);
    expect(driver.start).not.toHaveBeenCalled();
  });

  it("starts over from a stopped run that cannot be retried", () => {
    progress = progressAt("halted", false);
    mount();
    fireEvent.click(screen.getByText("predict"));

    expect(driver.reset).toHaveBeenCalled();
    expect(driver.start).toHaveBeenCalledTimes(1);
  });

  it("clears a stopped run when closed", () => {
    progress = progressAt("halted");
    const view = mount();
    fireEvent.click(screen.getByText("close"));

    expect(driver.reset).toHaveBeenCalled();
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });

  it("asks the run for a stored prediction as the popup opens", () => {
    mount();

    expect(driver.recover).toHaveBeenCalledTimes(1);
    expect(driver.start).not.toHaveBeenCalled();
  });

  it("resumes a stored run under review instead of starting one from the form", () => {
    progress = { ...progressAt("review"), recovered: { ...snapshot(), deposit: 7n } };
    mount();
    fireEvent.click(screen.getByText("predict"));

    expect(driver.resume).toHaveBeenCalledTimes(1);
    expect(driver.start).not.toHaveBeenCalled();
    expect(driver.reset).not.toHaveBeenCalled();
  });

  it("neither starts nor clears a stored run that stopped and cannot be retried", () => {
    progress = { ...progressAt("halted", false), recovered: snapshot() };
    mount();
    fireEvent.click(screen.getByText("predict"));

    expect(driver.start).not.toHaveBeenCalled();
    expect(driver.reset).not.toHaveBeenCalled();
    expect(driver.resume).not.toHaveBeenCalled();
  });

  it("keeps a stored run under review when closed", () => {
    progress = { ...progressAt("review"), recovered: snapshot() };
    const view = mount();
    fireEvent.click(screen.getByText("close"));

    expect(driver.reset).not.toHaveBeenCalled();
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });

  it("closes without touching a run that never started", () => {
    const view = mount();
    fireEvent.click(screen.getByText("close"));

    expect(driver.reset).not.toHaveBeenCalled();
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });
});

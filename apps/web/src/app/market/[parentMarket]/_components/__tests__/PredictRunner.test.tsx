import type { ComponentProps, ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccount } from "wagmi";

import type { PredictDialog } from "@/features/predict/components/PredictDialog";
import { snapshot } from "@/features/predict/flow/__tests__/support/fakes";
import { usePredictRun, type PredictRunInput } from "@/features/predict/hooks/usePredictRun";
import type { PredictDriver, PredictProgress, PredictStage } from "@/features/predict/run/types";
import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import type { PayToken, SelectedEstimate } from "@/features/predict/types";
import { planFunding } from "@/features/predict/utils/funding";
import { sessionChartKey } from "@/features/sessions/api/getSessionChart";
import { sessionStatsKey } from "@/features/sessions/api/getSessionStats";
import type { SessionDetail } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail, type SessionDetailRow } from "@/features/sessions/utils/toSessionDetail";
import { executorKey } from "@/features/trade-executor/api/getExecutor";
import { fundsKeyPrefix } from "@/features/trade-executor/api/getFunds";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { addresses, GATEWAY } from "@/testing/fixtures";

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
  useExecutor: () => ({ data: { predicted: EXECUTOR, deployed: true } }),
}));

vi.mock("../usePredictFunding", () => ({ usePredictFunding: vi.fn() }));

vi.mock("../useHasPredicted", () => ({ useHasPredicted: () => false }));

type DialogProps = ComponentProps<typeof PredictDialog>;

// The dialog is the runner's whole output; this stand-in exposes the props it was bound to.
vi.mock("@/features/predict/components/PredictDialog", () => ({
  PredictDialog: (props: DialogProps) => (
    <div>
      <p data-testid="notice">{props.notice ?? ""}</p>
      <p data-testid="running">{String(props.isRunning)}</p>
      <p data-testid="can-retry">{String(props.canRetry)}</p>
      <p data-testid="funds">{props.steps.rows.find((row) => row.key === "funds")?.subtitle}</p>
      <p data-testid="token">{props.token.symbol}</p>
      <p data-testid="listed">{props.selected.length}</p>
      <button onClick={() => props.onRemove(props.selected[0]!.scale.market)}>remove</button>
      <p data-testid="amount">{props.amount?.toString()}</p>
      <button onClick={() => props.onAmountChange(10n * 10n ** 18n)}>pay ten</button>
      <button onClick={() => props.onTokenChange("native")}>pay in xDAI</button>
      <button onClick={props.onClose}>close</button>
      <button onClick={props.onPredict}>predict</button>
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
  return { ...view, rerenderAt: () => view.rerender(ui()), invalidatedKeys, onClose, onSuccess, queryClient };
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
  heldMore = undefined;
  nativeAvailable = undefined;
  fundingMock.mockImplementation(({ token }) => ({
    funding: null,
    token: token ?? heldMore,
    available: (choice) => (choice === "native" ? nativeAvailable : undefined),
    canPayNative: true,
  }));
  runMock.mockImplementation((input) => {
    if (input) lastInput = input;
    return { driver, progress };
  });
});

describe("PredictRunner, what the visitor is told", () => {
  it("asks for a wallet when none is connected", () => {
    account(undefined, undefined);
    mount();

    expect(screen.getByTestId("notice")).toHaveTextContent("Connect a wallet to predict.");
  });

  it("asks for Gnosis when the wallet is on another chain", () => {
    connected(DEFAULT_CHAIN_ID + 1);
    mount();

    expect(screen.getByTestId("notice")).toHaveTextContent("Switch to Gnosis to predict.");
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

describe("PredictRunner, refreshing the chart, estimates, Traders and Volume after a prediction", () => {
  const POOL = addresses.childMarkets[0]!.toLowerCase();
  const TRADER = "0x5555555555555555555555555555555555555555";

  // An indexer that serves the pre-trade state for its first reads, then the trade.
  function indexerLagging(staleReads: number) {
    let reads = 0;
    vi.mocked(fetchGraphql).mockImplementation(async () => {
      const traded = reads++ >= staleReads;
      const swaps = traded ? [{ underlyingPerOutcomeAfter: "624000000000000000", timestamp: "1700000100" }] : [];
      return {
        Prediction: traded ? [{ executor_id: TRADER }] : [],
        Pool: [
          {
            id: POOL,
            childMarket_id: POOL,
            underlyingPerOutcome: traded ? "624000000000000000" : "500000000000000000",
            updatedAt: traded ? "1700000100" : "1700000000",
            volumeUnderlying: traded ? "1000000000000000000" : "0",
            swaps,
          },
        ],
      };
    });
  }

  // Seeds the page's cached chart and stats so the test can read whether each was marked stale.
  // No observer holds them here, so they are kept from garbage collection across the fake ten minutes.
  function seedPageQueries(queryClient: QueryClient, sessionId: string) {
    queryClient.setQueryDefaults(sessionChartKey(sessionId), { gcTime: Infinity });
    queryClient.setQueryDefaults(sessionStatsKey(sessionId), { gcTime: Infinity });
    queryClient.setQueryData(sessionChartKey(sessionId), []);
    queryClient.setQueryData(sessionStatsKey(sessionId), { traders: 0, volumeUnderlying: 0n });
  }

  const isInvalidated = (queryClient: QueryClient, key: readonly unknown[]) =>
    queryClient.getQueryState(key)?.isInvalidated ?? false;

  // Ten minutes of timers, stepped so promises between them resolve.
  async function letRefreshRun() {
    for (let i = 0; i < 120; i++) await vi.advanceTimersByTimeAsync(5_000);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    indexerLagging(2);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks both the session chart and the session stats stale once a run completes", async () => {
    const detail = session();
    const view = mount(detail);
    seedPageQueries(view.queryClient, detail.id);

    lastInput?.onComplete?.();
    progress = progressAt("complete");
    view.rerenderAt();
    await letRefreshRun();

    expect({
      chart: isInvalidated(view.queryClient, sessionChartKey(detail.id)),
      stats: isInvalidated(view.queryClient, sessionStatsKey(detail.id)),
    }).toEqual({ chart: true, stats: true });
  });

  it("refreshes Traders and Volume once a run completes", async () => {
    const detail = session();
    const view = mount(detail);
    seedPageQueries(view.queryClient, detail.id);

    lastInput?.onComplete?.();
    progress = progressAt("complete");
    view.rerenderAt();
    await letRefreshRun();

    expect(view.invalidatedKeys()).toContainEqual([...sessionStatsKey(detail.id)]);
  });

  it("still refreshes the chart and the stats after the popup closes on success", async () => {
    const detail = session();
    const view = mount(detail);
    seedPageQueries(view.queryClient, detail.id);

    lastInput?.onComplete?.();
    progress = progressAt("complete");
    view.rerenderAt();
    view.unmount();
    await letRefreshRun();

    expect({
      chart: isInvalidated(view.queryClient, sessionChartKey(detail.id)),
      stats: isInvalidated(view.queryClient, sessionStatsKey(detail.id)),
    }).toEqual({ chart: true, stats: true });
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

  it("picks a retryable stopped run back up once it has moved money, with the form locked", () => {
    progress = { ...progressAt("halted", true), moneyMoved: true };
    mount();
    expect(screen.getByTestId("can-retry")).toHaveTextContent("true");
    fireEvent.click(screen.getByText("predict"));

    expect(driver.retry).toHaveBeenCalledTimes(1);
    expect(driver.start).not.toHaveBeenCalled();
  });

  it("locks the form to a run whose transaction may still mine, and checks it rather than starting over", () => {
    progress = { ...progressAt("halted", true), pendingHash: `0x${"ab".repeat(32)}` };
    mount();
    expect(screen.getByTestId("can-retry")).toHaveTextContent("true");
    fireEvent.click(screen.getByText("predict"));

    expect(driver.retry).toHaveBeenCalledTimes(1);
    expect(driver.start).not.toHaveBeenCalled();
  });

  it("shows the amount now typed, not the one pressed, once a run stops before money moved", () => {
    fundingMock.mockImplementation(({ amount }) => ({
      funding: planFunding({ amount, ownWallet: 100n * 10n ** 18n, tradeWallet: 0n }),
      token: "collateral",
      available: () => undefined,
      canPayNative: false,
    }));
    const view = mount();
    fireEvent.click(screen.getByText("pay ten"));
    fireEvent.click(screen.getByText("predict"));
    progress = progressAt("halted", true);
    view.rerenderAt();
    expect(screen.getByTestId("funds")).toHaveTextContent(/^10 sDAI$/);

    fundingMock.mockImplementation(() => ({
      funding: planFunding({ amount: 4n * 10n ** 18n, ownWallet: 100n * 10n ** 18n, tradeWallet: 0n }),
      token: "collateral",
      available: () => undefined,
      canPayNative: false,
    }));
    view.rerenderAt();

    expect(screen.getByTestId("funds")).toHaveTextContent(/^4 sDAI$/);
  });

  it("starts over from the form when a retryable run stopped before anything reached the chain", () => {
    progress = progressAt("halted", true, [
      { id: "create-wallet", label: "Create", state: "success" },
      { id: "deposit", label: "Deposit", state: "error" },
    ]);
    mount();
    expect(screen.getByTestId("can-retry")).toHaveTextContent("false");
    fireEvent.click(screen.getByText("predict"));

    expect(driver.retry).not.toHaveBeenCalled();
    expect(driver.reset).toHaveBeenCalled();
    expect(driver.start).toHaveBeenCalledTimes(1);
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

  it("shows the stored run's deposit in the steps, not the form's", () => {
    progress = { ...progressAt("review"), recovered: { ...snapshot(), deposit: 7_250_000_000_000_000_000n } };
    mount();

    expect(screen.getByTestId("funds")).toHaveTextContent(/^7\.25 /);
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

describe("PredictRunner, draft removals and the default token", () => {
  it("clears an estimate removed in the popup only once predict is pressed", () => {
    const detail = session();
    const market = detail.options[0]!.market;
    useEstimateStore.setState({ estimates: {} });
    useEstimateStore.getState().setEstimate(detail.parentMarket, market, 312);
    const saved = () => useEstimateStore.getState().estimates[detail.parentMarket.toLowerCase()];
    mount(detail);

    fireEvent.click(screen.getByText("remove"));
    expect(screen.getByTestId("listed")).toHaveTextContent("0");
    expect(saved()).toEqual({ [market.toLowerCase()]: 312 });

    fireEvent.click(screen.getByText("predict"));
    expect(saved()).toBeUndefined();
  });

  it("keeps the default token when a balance refresh would now pick the other one", () => {
    heldMore = "native";
    const view = mount();
    expect(screen.getByTestId("token")).toHaveTextContent("xDAI");

    heldMore = "collateral";
    view.rerenderAt();

    expect(screen.getByTestId("token")).toHaveTextContent("xDAI");
  });

  it("clamps the amount to the new token's balance rounded down to the shown decimals", () => {
    heldMore = "collateral";
    nativeAvailable = 5_000_012_340_000_000_000n;
    mount();

    fireEvent.click(screen.getByText("pay ten"));
    fireEvent.click(screen.getByText("pay in xDAI"));

    expect(screen.getByTestId("token")).toHaveTextContent("xDAI");
    expect(screen.getByTestId("amount")).toHaveTextContent(/^5000000000000000000$/);
  });
});

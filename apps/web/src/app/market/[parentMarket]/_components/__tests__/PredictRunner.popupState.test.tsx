import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Address } from "viem";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PredictRunInput } from "@/features/predict/hooks/usePredictRun";
import { DEFAULT_SLIPPAGE, GAS_RESERVE_WEI } from "@/features/predict/oracle/tolerances";
import type { PredictDriver, PredictProgress } from "@/features/predict/run/types";
import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import { useSlippageStore } from "@/features/predict/stores/slippageStore";
import type { PreviewTrades } from "@/features/predict/utils/plan";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { estimateToPriceWad } from "@/utils/optionPrice";

import { SHOWN } from "@/test/queries";
import { addresses, GATEWAY } from "@/testing/fixtures";

import { PredictCard } from "../PredictCard";

const THIRD_MARKET = "0x5555555555555555555555555555555555555555" as Address;
const WAD = 10n ** 18n;

const OPTIONS = [
  { market: addresses.childMarkets[0], name: "Greta Gerwig" },
  { market: addresses.childMarkets[1], name: "Denis Villeneuve" },
  { market: THIRD_MARKET, name: "Chloe Zhao" },
] as const;

/** The visitor's own wallet, and the sDAI already in the trade wallet. Set per test before the popup opens. */
const wallet = vi.hoisted(() => ({ sDai: 0n, xDai: 0n, trade: 0n }));
/** Last input the page handed the run. */
const runInput = vi.hoisted(() => ({ current: null as PredictRunInput | null }));
const pools = vi.hoisted(() => ({
  ready: true,
  failed: false,
  failedAgain: false,
  retrying: false,
  retry: (() => {}) as () => void,
}));

vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
/* The factory cannot reference imports, so GATEWAY's value is restated. */
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://cdn.example.link/ipfs" }));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

vi.mock("wagmi", async (importOriginal) => {
  const { DEFAULT_CHAIN_ID } = await import("@/config/chains");
  return {
    ...(await importOriginal<typeof import("wagmi")>()),
    useAccount: () => ({ address: "0x9999999999999999999999999999999999999999", chainId: DEFAULT_CHAIN_ID }),
  };
});

// The test chain has no Seer router or sDAI adapter; the session's collateral stands in for sDAI so xDAI is payable.
vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  gnosisRouterAddress: () => "0x7777777777777777777777777777777777777777",
  tradeExecutorFactoryAddress: () => "0x6666666666666666666666666666666666666666",
  sDaiDepositRoute: (collateral: Address) => ({
    sDai: collateral,
    sDaiAdapter: "0x4444444444444444444444444444444444444444",
  }),
}));

vi.mock("@/features/trade-executor/api/getExecutor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/trade-executor/api/getExecutor")>()),
  useExecutor: () => ({ data: { predicted: "0x8888888888888888888888888888888888888888", deployed: true } }),
}));

// Balances as the chain reports them: native plus the asked-for token, per holder.
vi.mock("@/features/trade-executor/api/getFunds", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/trade-executor/api/getFunds")>()),
  useFunds: (holder: Address | undefined, token: Address | undefined) => {
    if (!holder) return { data: undefined, isPending: true };
    const own = holder.toLowerCase() === "0x9999999999999999999999999999999999999999";
    return {
      data: { native: own ? wallet.xDai : 0n, token: token ? (own ? wallet.sDai : wallet.trade) : null },
      isPending: false,
    };
  },
}));

// 1.25 xDAI per sDAI, read only when an sDAI address is asked for, as the real query is.
vi.mock("@/features/predict/api/getSavingsRate", () => ({
  useSavingsRate: (sDai: Address | undefined) =>
    sDai ? { data: (5n * 10n ** 18n) / 4n, isPending: false } : { data: undefined, isPending: true },
}));

vi.mock("../useHasPredicted", () => ({ useHasPredicted: () => false }));
// the pools read for Details; the run is a fake, so no plan is compared
vi.mock("../usePricePreview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../usePricePreview")>()),
  usePricePreview: () => ({
    moves: {},
    plans: {},
    held: {},
    ready: pools.ready,
    failed: pools.failed,
    failedAgain: pools.failedAgain,
    retrying: pools.retrying,
    retry: pools.retry,
  }),
}));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));

const driver = {
  start: vi.fn<PredictDriver["start"]>(),
  recover: vi.fn<PredictDriver["recover"]>(),
  resume: vi.fn<PredictDriver["resume"]>(),
  confirm: vi.fn<PredictDriver["confirm"]>(),
  retry: vi.fn<PredictDriver["retry"]>(),
  reset: vi.fn<PredictDriver["reset"]>(),
  dispose: vi.fn<PredictDriver["dispose"]>(),
  subscribe: vi.fn<PredictDriver["subscribe"]>(() => () => {}),
  getProgress: vi.fn<PredictDriver["getProgress"]>(),
} satisfies PredictDriver;

const idle: PredictProgress = { stage: "idle", steps: [], leftOut: [], batchesDone: 0, batches: 0 };

/** The run's progress as the page reads it; `set` re-renders the popup. */
const run = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let progress: PredictProgress = { stage: "idle", steps: [], leftOut: [], batchesDone: 0, batches: 0 };
  return {
    get: () => progress,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next: PredictProgress) => {
      progress = next;
      for (const listener of listeners) listener();
    },
  };
});

vi.mock("@/features/predict/hooks/usePredictRun", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePredictRun: (input: PredictRunInput | null) => {
      if (input) runInput.current = input;
      const progress = useSyncExternalStore(run.subscribe, run.get);
      return { driver: input ? driver : null, progress };
    },
  };
});

const session = () =>
  toSessionDetail(
    {
      ...sessionDetailColumns,
      children: OPTIONS.map((option, index) =>
        sessionChildRow({ id: option.market, displayName: option.name, parentOutcomeIndex: String(index) }),
      ),
    },
    GATEWAY,
  );

const ESTIMATE = 312;
const MARKET_ESTIMATE = 250;

const savedEstimates = (parentMarket: string) => useEstimateStore.getState().estimates[parentMarket.toLowerCase()];

function renderPage() {
  const detail = session();
  for (const option of OPTIONS) useEstimateStore.getState().setEstimate(detail.parentMarket, option.market, ESTIMATE);
  const marketEstimates = Object.fromEntries(OPTIONS.map((option) => [option.market, MARKET_ESTIMATE]));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <PredictCard session={detail} status="trading" marketEstimates={marketEstimates} />
    </QueryClientProvider>,
  );
  return detail;
}

const fundsSubtitle = (popup: ReturnType<typeof within>) =>
  popup.getByRole("listitem", { name: "Timeline item: Add funds" }).querySelector("h2 + p")?.textContent ?? "";

async function openPopup() {
  await userEvent.click(screen.getByRole("button", { name: /^Predict (\d+ )?estimates?$/ }));
  return within(await screen.findByRole("dialog"));
}

/** The pay token the popup's balance line is quoted in. */
async function balanceToken(popup: ReturnType<typeof within>) {
  const line = await popup.findByTitle(/^Balance: /);
  return line.textContent?.trim().split(" ").at(-1);
}

const amountField = (popup: ReturnType<typeof within>) => popup.getByRole("spinbutton");

async function chooseToken(popup: ReturnType<typeof within>, symbol: "sDAI" | "xDAI") {
  await userEvent.click(popup.getByRole("button", { name: /Token/ }));
  await userEvent.click(await screen.findByRole("option", { name: symbol }));
}

// PredictCard loads PredictRunner with next/dynamic on first open; importing it here keeps its
// first load out of the first test's timeout.
beforeAll(async () => {
  await import("../PredictRunner");
});

beforeEach(() => {
  Object.assign(pools, { ready: true, failed: false, failedAgain: false, retrying: false, retry: vi.fn() });
  vi.clearAllMocks();
  window.localStorage.clear();
  useEstimateStore.setState({ estimates: {} });
  useSlippageStore.setState({ settings: { tradeBps: null, creditsBps: null } });
  runInput.current = null;
  wallet.sDai = 0n;
  wallet.xDai = 0n;
  wallet.trade = 0n;
  run.set(idle);
});

describe("estimates removed in the popup are a draft until Predict", () => {
  const removals = [
    ["one estimate", [OPTIONS[0]]],
    ["two estimates", [OPTIONS[0], OPTIONS[2]]],
  ] as const;

  it.each(removals)("closing puts back %s removed in the popup", async (_label, removed) => {
    wallet.sDai = 10n * WAD;
    const detail = renderPage();
    const popup = await openPopup();

    for (const option of removed) await userEvent.click(popup.getByRole("button", { name: `Remove ${option.name}` }));
    // each row fades out before it leaves
    await waitFor(() => {
      for (const option of removed) expect(popup.queryByText(option.name, SHOWN)).toBeNull();
    });

    await userEvent.click(popup.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(savedEstimates(detail.parentMarket)).toEqual(
      Object.fromEntries(OPTIONS.map((option) => [option.market.toLowerCase(), ESTIMATE])),
    );
    const reopened = await openPopup();
    for (const option of OPTIONS) expect(reopened.getByText(option.name, SHOWN)).toBeInTheDocument();
  });

  it("leaves a removed estimate out of the prediction while the popup is open", async () => {
    wallet.sDai = 10n * WAD;
    renderPage();
    const popup = await openPopup();

    await userEvent.click(popup.getByRole("button", { name: `Remove ${OPTIONS[1].name}` }));

    await waitFor(() =>
      expect(runInput.current?.options().map((option) => option.childMarket.toLowerCase())).toEqual(
        [OPTIONS[0].market, OPTIONS[2].market].map((market) => market.toLowerCase()),
      ),
    );
  });
});

describe("switching the pay token keeps the typed amount, clamped to the new balance", () => {
  it("keeps an amount that fits the new token's balance, both ways", async () => {
    // 10 sDAI and 8 xDAI spendable: sDAI is worth more, so the popup opens on it
    wallet.sDai = 10n * WAD;
    wallet.xDai = 8n * WAD + GAS_RESERVE_WEI;
    renderPage();
    const popup = await openPopup();
    expect(await balanceToken(popup)).toBe("sDAI");

    fireEvent.change(popup.getByRole("slider"), { target: { value: "50" } });
    await waitFor(() => expect(amountField(popup)).toHaveValue("5"));
    expect(popup.getByText("5 sDAI from your wallet")).toBeInTheDocument();

    // 5 xDAI is 4 sDAI at 1.25 xDAI per sDAI
    await chooseToken(popup, "xDAI");
    await waitFor(() => expect(popup.getByTitle(/^Balance: 8 xDAI/)).toBeInTheDocument());
    expect(amountField(popup)).toHaveValue("5");
    expect(popup.getByText("≈ 4 sDAI from your wallet")).toBeInTheDocument();

    await chooseToken(popup, "sDAI");
    await waitFor(() => expect(popup.getByTitle(/^Balance: 10 sDAI/)).toBeInTheDocument());
    expect(amountField(popup)).toHaveValue("5");
    expect(popup.getByText("5 sDAI from your wallet")).toBeInTheDocument();
  });

  it("clamps an amount larger than the new token's balance to that balance", async () => {
    wallet.sDai = 10n * WAD;
    wallet.xDai = 5n * WAD + GAS_RESERVE_WEI;
    renderPage();
    const popup = await openPopup();
    expect(await balanceToken(popup)).toBe("sDAI");

    await userEvent.click(popup.getByRole("button", { name: "Max" }));
    await waitFor(() => expect(amountField(popup)).toHaveValue("10"));

    await chooseToken(popup, "xDAI");
    await waitFor(() => expect(popup.getByTitle(/^Balance: 5 xDAI/)).toBeInTheDocument());
    expect(amountField(popup)).toHaveValue("5");
    // 5 xDAI is 4 sDAI at 1.25 xDAI per sDAI
    expect(popup.getByText("≈ 4 sDAI from your wallet")).toBeInTheDocument();
    expect(popup.queryByText(/Not enough balance/)).toBeNull();
  });
});

describe("the popup opens on a pay token the wallet holds", () => {
  // own wallet balances; 1.25 xDAI buys 1 sDAI
  const wallets = [
    { name: "only xDAI", sDai: 0n, xDai: 50n * WAD, expected: "xDAI" },
    { name: "only sDAI", sDai: 10n * WAD, xDai: 0n, expected: "sDAI" },
    { name: "more xDAI than sDAI, by value", sDai: 10n * WAD, xDai: 30n * WAD, expected: "xDAI" },
    { name: "more sDAI than xDAI, by value", sDai: 10n * WAD, xDai: 5n * WAD, expected: "sDAI" },
    { name: "nothing", sDai: 0n, xDai: 0n, expected: "sDAI" },
  ] as const;

  it.each(wallets)("opens on $expected with $name", async ({ sDai, xDai, expected }) => {
    wallet.sDai = sDai;
    wallet.xDai = xDai;
    renderPage();
    const popup = await openPopup();

    await waitFor(async () => expect(await balanceToken(popup)).toBe(expected));
  });

  it("opens on xDAI again after closing when the wallet holds only xDAI", async () => {
    wallet.xDai = 50n * WAD;
    renderPage();
    let popup = await openPopup();
    await waitFor(async () => expect(await balanceToken(popup)).toBe("xDAI"));

    await userEvent.click(popup.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    popup = await openPopup();

    await waitFor(async () => expect(await balanceToken(popup)).toBe("xDAI"));
    expect(popup.queryByText(/Not enough balance/)).toBeNull();
  });
});

describe("the funds step names what the visitor pays", () => {
  it("names nothing to add for an amount over the balance", async () => {
    wallet.sDai = 10n * WAD;
    renderPage();
    const popup = await openPopup();
    expect(await balanceToken(popup)).toBe("sDAI");

    await userEvent.type(amountField(popup), "999");

    expect(await popup.findByText(/Not enough balance/)).toBeInTheDocument();
    expect(fundsSubtitle(popup)).toBe("");
  });

  it("names an sDAI payment in sDAI alone", async () => {
    wallet.sDai = 10n * WAD;
    renderPage();
    const popup = await openPopup();
    expect(await balanceToken(popup)).toBe("sDAI");

    await userEvent.type(amountField(popup), "5");

    await waitFor(() => expect(fundsSubtitle(popup)).toBe("5 sDAI"));
  });

  it("names an xDAI payment in xDAI with the sDAI it becomes, held from Predict until the run stops", async () => {
    wallet.xDai = 8n * WAD + GAS_RESERVE_WEI;
    renderPage();
    const popup = await openPopup();
    await waitFor(async () => expect(await balanceToken(popup)).toBe("xDAI"));

    await userEvent.type(amountField(popup), "5");
    // 5 xDAI is 4 sDAI at 1.25 xDAI per sDAI
    await waitFor(() => expect(fundsSubtitle(popup)).toBe("5 xDAI (≈ 4 sDAI)"));

    await userEvent.click(popup.getByRole("button", { name: "Predict" }));
    expect(driver.start).toHaveBeenCalledOnce();
    act(() => run.set({ ...idle, stage: "quoting" }));
    // 1 sDAI in the trade wallet leaves 3 sDAI, 3.75 xDAI, to add
    wallet.trade = WAD;
    act(() => run.set({ ...idle, stage: "signing" }));
    expect(fundsSubtitle(popup)).toBe("5 xDAI (≈ 4 sDAI)");

    act(() => run.set(idle));
    await waitFor(() => expect(fundsSubtitle(popup)).toBe("3.75 xDAI (≈ 3 sDAI)"));
  });
});

describe("prices that moved when Predict read the pools again", () => {
  /** A plan that moves the option from the market's 250 to `to`, in the option's unit. */
  const planTo = (scale: Parameters<typeof estimateToPriceWad>[1], to: number): PreviewTrades => ({
    split: WAD,
    sells: [],
    merge: 0n,
    buys: [{ side: "up", amountIn: WAD, toTarget: false, fee: 0n, outcomeOut: WAD }],
    from: estimateToPriceWad(MARKET_ESTIMATE, scale),
    to: estimateToPriceWad(to, scale),
    feeValue: 0n,
  });

  async function pressPredict() {
    wallet.sDai = 10n * WAD;
    const detail = renderPage();
    const popup = await openPopup();
    await userEvent.type(amountField(popup), "5");
    await userEvent.click(popup.getByRole("button", { name: "Predict" }));
    return { detail, popup };
  }

  function move(detail: ReturnType<typeof session>, to: number) {
    const scale = detail.options[0]!;
    act(() =>
      run.set({
        ...idle,
        stage: "moved",
        moved: { markets: [scale.market], plans: { [scale.market.toLowerCase()]: planTo(scale, to) } },
      }),
    );
  }

  it("holds the run to the plans Details showed", async () => {
    await pressPredict();

    expect(driver.start).toHaveBeenCalledWith(expect.any(Object));
  });

  it("shows the new figures and confirms them rather than starting again", async () => {
    const { detail, popup } = await pressPredict();
    move(detail, 300);

    await userEvent.click(within(popup.getByTestId("predict-summary")).getAllByRole("button")[0]!);
    expect(popup.getAllByTestId("market-move")[0]).toHaveTextContent(/→ 300/);
    await userEvent.click(popup.getByRole("button", { name: "Confirm new prices" }));

    expect(driver.confirm).toHaveBeenCalledOnce();
    expect(driver.start).toHaveBeenCalledOnce();
  });

  it("keeps the confirmed figures on show while the run goes", async () => {
    const { detail, popup } = await pressPredict();
    move(detail, 300);
    await userEvent.click(popup.getByRole("button", { name: "Confirm new prices" }));

    const scale = detail.options[0]!;
    act(() =>
      run.set({ ...idle, stage: "signing", held: { plans: { [scale.market.toLowerCase()]: planTo(scale, 300) } } }),
    );
    await userEvent.click(within(popup.getByTestId("predict-summary")).getAllByRole("button")[0]!);

    expect(popup.getAllByTestId("market-move")[0]).toHaveTextContent(/→ 300/);
  });

  it("keeps the funds step as pressed when a run stops at moved after its deposit landed", async () => {
    const { detail, popup } = await pressPredict();
    const pressed = fundsSubtitle(popup);
    wallet.trade = 5n * WAD;
    const scale = detail.options[0]!;
    act(() =>
      run.set({
        ...idle,
        stage: "moved",
        moneyMoved: true,
        moved: { markets: [scale.market], plans: { [scale.market.toLowerCase()]: planTo(scale, 300) } },
      }),
    );

    expect(fundsSubtitle(popup)).toBe(pressed);
  });

  it("gives the form back from Go back, keeping the popup open", async () => {
    const { detail, popup } = await pressPredict();
    move(detail, 300);

    await userEvent.click(popup.getByRole("button", { name: "Go back" }));

    expect(driver.reset).toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("offers no Go back once money has moved", async () => {
    const { detail, popup } = await pressPredict();
    const scale = detail.options[0]!;
    act(() =>
      run.set({
        ...idle,
        stage: "moved",
        moneyMoved: true,
        moved: { markets: [scale.market], plans: { [scale.market.toLowerCase()]: planTo(scale, 300) } },
      }),
    );

    expect(popup.queryByRole("button", { name: "Go back" })).toBeNull();
  });

  it("throws the moved check away when the popup closes", async () => {
    const { detail, popup } = await pressPredict();
    move(detail, 300);

    await userEvent.click(popup.getByRole("button", { name: "Close" }));

    expect(driver.reset).toHaveBeenCalled();
  });
});

describe("Predict before the pools are read", () => {
  it("waits while Details reads them, and says so when they cannot be read", async () => {
    wallet.sDai = 10n * WAD;
    pools.ready = false;
    renderPage();
    const popup = await openPopup();
    await userEvent.type(amountField(popup), "5");

    expect(popup.getByRole("button", { name: "Predict" })).toBeDisabled();

    pools.failed = true;
    await userEvent.type(amountField(popup), "1");
    expect(popup.getByRole("status")).toHaveTextContent(/^Prices could not be read\.$/);
  });

  it("says so in new words when a second read fails too", async () => {
    wallet.sDai = 10n * WAD;
    pools.failed = true;
    pools.failedAgain = true;
    renderPage();
    const popup = await openPopup();

    expect(popup.getByRole("status")).toHaveTextContent(/^Prices still could not be read\.$/);
  });

  it("reads them again from Try again", async () => {
    wallet.sDai = 10n * WAD;
    pools.failed = true;
    renderPage();
    const popup = await openPopup();

    await userEvent.click(popup.getByRole("button", { name: "Try again" }));

    expect(pools.retry).toHaveBeenCalledOnce();
    expect(driver.start).not.toHaveBeenCalled();
  });
});

describe("a run stopped after money moved", () => {
  it("keeps Try the rest, which needs no prices from the form, where the pools cannot be read", async () => {
    wallet.sDai = 10n * WAD;
    renderPage();
    const popup = await openPopup();
    pools.failed = true;
    act(() =>
      run.set({
        ...idle,
        stage: "halted",
        moneyMoved: true,
        failure: { reason: "reverted", retryable: true },
        held: { plans: {} },
      }),
    );

    await userEvent.click(popup.getByRole("button", { name: "Try the rest" }));

    expect(driver.retry).toHaveBeenCalledOnce();
    expect(pools.retry).not.toHaveBeenCalled();
    expect(popup.getByRole("status")).toHaveTextContent(/^The trade failed at these prices\./);
  });

  it("lets the slippage change, and Try the rest retries with the new setting for the run to take up", async () => {
    wallet.sDai = 10n * WAD;
    renderPage();
    const popup = await openPopup();
    act(() =>
      run.set({
        ...idle,
        stage: "halted",
        moneyMoved: true,
        failure: { reason: "reverted", retryable: true },
        held: { plans: {} },
      }),
    );

    await userEvent.click(popup.getByRole("button", { name: "Settings" }));
    await userEvent.type(popup.getByRole("textbox", { name: "Max slippage on trades, custom percent" }), "3");
    await userEvent.click(popup.getByRole("button", { name: "Done" }));
    await userEvent.click(popup.getByRole("button", { name: "Try the rest" }));

    expect(driver.retry).toHaveBeenCalledOnce();
    expect(runInput.current?.slippage()).toEqual({ tradeBps: 300, creditsBps: DEFAULT_SLIPPAGE.creditsBps });
  });
});

describe("the slippage a run uses", () => {
  it("is the visitor's setting as Predict is pressed, Auto where they set none", async () => {
    wallet.sDai = 10n * WAD;
    renderPage();
    const popup = await openPopup();

    await userEvent.click(popup.getByRole("button", { name: "Settings" }));
    await userEvent.type(popup.getByRole("textbox", { name: "Max slippage on trades, custom percent" }), "3");
    await userEvent.tab();

    expect(runInput.current?.slippage()).toEqual({ tradeBps: 300, creditsBps: DEFAULT_SLIPPAGE.creditsBps });
  });
});

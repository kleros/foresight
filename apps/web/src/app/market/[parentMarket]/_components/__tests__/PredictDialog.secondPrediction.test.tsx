import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Address } from "viem";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PredictDriver, PredictProgress } from "@/features/predict/run/types";
import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import type { Funding } from "@/features/predict/utils/funding";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { addresses, GATEWAY } from "@/testing/fixtures";

import { PredictCard } from "../PredictCard";

const THIRD_MARKET = "0x5555555555555555555555555555555555555555" as Address;
const WAD = 10n ** 18n;

const OPTIONS = [
  { market: addresses.childMarkets[0], name: "Greta Gerwig" },
  { market: addresses.childMarkets[1], name: "Denis Villeneuve" },
  { market: THIRD_MARKET, name: "Chloe Zhao" },
] as const;

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

vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  gnosisRouterAddress: () => "0x7777777777777777777777777777777777777777",
  tradeExecutorFactoryAddress: () => "0x6666666666666666666666666666666666666666",
}));

vi.mock("@/features/trade-executor/api/getExecutor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/trade-executor/api/getExecutor")>()),
  useExecutor: () => ({ data: { predicted: "0x8888888888888888888888888888888888888888", deployed: true } }),
}));

/** A returning visitor whose trade wallet already holds collateral and who types no extra amount. */
const balances = vi.hoisted(() => ({ funding: null as Funding | null }));
vi.mock("../usePredictFunding", () => ({
  usePredictFunding: () => ({
    funding: balances.funding,
    token: "collateral",
    available: () => balances.funding?.available,
    canPayNative: false,
    isPending: false,
  }),
}));
vi.mock("../useHasPredicted", () => ({ useHasPredicted: () => true }));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));

/* A visitor already subscribed, so the success dialog renders without the sign-in flow. */
vi.mock("@kleros/kleros-app", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kleros/kleros-app")>()),
  useAtlasProvider: () => ({ user: { email: "visitor@example.com" }, userExists: true }),
}));

/** The run's progress as the real driver reports it; the mock hook re-renders on every change. */
const run = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let progress: unknown = null;
  return {
    get: () => progress,
    set(next: unknown) {
      progress = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock("@/features/predict/hooks/usePredictRun", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePredictRun: (input: unknown) => ({
      driver: input ? driver : null,
      progress: useSyncExternalStore(run.subscribe, run.get, run.get),
    }),
  };
});

const progressAt = (stage: PredictProgress["stage"]): PredictProgress => ({
  stage,
  steps: [],
  skipped: [],
  batchesDone: stage === "complete" ? 1 : 0,
  batches: 1,
});

// reset() throws the run away, as the real driver does.
const driver = {
  start: vi.fn<PredictDriver["start"]>(),
  recover: vi.fn<PredictDriver["recover"]>(),
  resume: vi.fn<PredictDriver["resume"]>(),
  retry: vi.fn<PredictDriver["retry"]>(),
  reset: vi.fn<PredictDriver["reset"]>(() => run.set(progressAt("idle"))),
  dispose: vi.fn<PredictDriver["dispose"]>(),
  subscribe: vi.fn<PredictDriver["subscribe"]>(() => () => {}),
  getProgress: vi.fn<PredictDriver["getProgress"]>(() => progressAt("idle")),
} satisfies PredictDriver;

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

const FIRST_ESTIMATE = 312;
const MARKET_BEFORE = 250;
// the first prediction moved each market toward the estimate without reaching it
const MARKET_AFTER = 290;

const marketAt = (value: number) => Object.fromEntries(OPTIONS.map((option) => [option.market, value]));

const fundingCoveredByTradeWallet = (): Funding => ({
  available: 20n * WAD,
  collateralIn: 0n,
  tradeWallet: 5n * WAD,
  fromTradeWallet: 0n,
  toAdd: 0n,
  deposit: 0n,
});

/** Places a first prediction on every option, then changes `changed` and opens the popup again. */
async function openSecondPrediction(changed: (typeof OPTIONS)[number]) {
  const detail = session();
  for (const option of OPTIONS)
    useEstimateStore.getState().setEstimate(detail.parentMarket, option.market, FIRST_ESTIMATE);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const card = (marketEstimates: Record<string, number>) => (
    <QueryClientProvider client={client}>
      <PredictCard session={detail} status="trading" marketEstimates={marketEstimates} />
    </QueryClientProvider>
  );

  const view = render(card(marketAt(MARKET_BEFORE)));
  await userEvent.click(screen.getByRole("button", { name: /^Predict (\d+ )?estimates?$/ }));
  const first = within(await screen.findByRole("dialog"));
  for (const option of OPTIONS) expect(first.getByText(option.name)).toBeInTheDocument();
  act(() => run.set(progressAt("signing")));
  act(() => run.set(progressAt("complete")));

  await userEvent.click(await screen.findByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  balances.funding = fundingCoveredByTradeWallet();
  view.rerender(card(marketAt(MARKET_AFTER)));
  act(() => useEstimateStore.getState().setEstimate(detail.parentMarket, changed.market, 420));

  await userEvent.click(screen.getByRole("button", { name: /^Predict (\d+ )?estimates?$/ }));
  return within(await screen.findByRole("dialog"));
}

// PredictCard loads these with next/dynamic on first open; importing them here keeps their
// first load out of the first test's timeout.
beforeAll(async () => {
  await Promise.all([import("../PredictRunner"), import("../PredictSuccessDialog")]);
});

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  useEstimateStore.setState({ estimates: {} });
  balances.funding = null;
  run.set(progressAt("idle"));
});

describe("PredictDialog on a second prediction with one changed option", () => {
  it.each(OPTIONS.map((option) => [option.name, option] as const))(
    "lists only %s and leaves the unchanged options out",
    async (_name, changed) => {
      const popup = await openSecondPrediction(changed);

      expect(popup.getByText(changed.name)).toBeInTheDocument();
      for (const option of OPTIONS.filter((candidate) => candidate !== changed))
        expect(popup.queryByText(option.name)).toBeNull();
    },
  );

  it("shows no 'Adding 0 sDAI' step when the trade wallet covers it", async () => {
    const popup = await openSecondPrediction(OPTIONS[1]);

    expect(popup.queryByText(/Adding 0 sDAI/)).toBeNull();
    expect(popup.queryByText(/Adding 0\b/)).toBeNull();
  });
});

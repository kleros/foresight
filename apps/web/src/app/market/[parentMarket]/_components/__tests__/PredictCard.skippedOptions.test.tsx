import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PredictDriver, PredictProgress } from "@/features/predict/run/types";
import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { addresses, GATEWAY } from "@/testing/fixtures";

import { PredictCard } from "../PredictCard";

const THIRD_MARKET = "0x5555555555555555555555555555555555555555" as Address;

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
vi.mock("../usePredictFunding", () => ({
  usePredictFunding: () => ({ funding: null, canPayNative: false, isPending: false }),
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

const progressAt = (stage: PredictProgress["stage"], skipped: Address[] = []): PredictProgress => ({
  stage,
  steps: [],
  skipped,
  batchesDone: stage === "complete" ? 1 : 0,
  batches: 1,
});

// reset() throws the run away, its skipped list included, as the real driver does.
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

const MARKET_ESTIMATE = 250;

async function predictAndComplete(skipped: Address[]) {
  const detail = session();
  for (const option of OPTIONS) useEstimateStore.getState().setEstimate(detail.parentMarket, option.market, 312);
  const marketEstimates = Object.fromEntries(OPTIONS.map((option) => [option.market, MARKET_ESTIMATE]));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <PredictCard session={detail} status="trading" marketEstimates={marketEstimates} />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Predict selected" }));
  await screen.findByRole("dialog");
  act(() => run.set(progressAt("signing")));
  act(() => run.set(progressAt("complete", skipped)));

  await screen.findByText(/Prediction placed/);
  expect(driver.reset).toHaveBeenCalled();
  return within(screen.getByRole("dialog"));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  useEstimateStore.setState({ estimates: {} });
  run.set(progressAt("idle"));
});

describe("a successful prediction that left options out", () => {
  const cases = [
    ["one option", [OPTIONS[1]]],
    ["two options", [OPTIONS[0], OPTIONS[2]]],
  ] as const;

  it.each(cases)("names %s left out in the success dialog", async (_label, left) => {
    const success = await predictAndComplete(left.map((option) => option.market));

    for (const option of left) expect(success.getByText(new RegExp(option.name))).toBeInTheDocument();
    for (const option of OPTIONS.filter((candidate) => !left.includes(candidate as never)))
      expect(success.queryByText(new RegExp(option.name))).toBeNull();
  });
});

import { act, type ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Address } from "viem";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PredictDriver, PredictProgress } from "@/features/predict/run/types";
import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { addresses, GATEWAY } from "@/testing/fixtures";

import { PredictCard } from "../PredictCard";

const OWNER = "0x9999999999999999999999999999999999999999" as Address;
const WAD = 10n ** 18n;

const OPTIONS = [
  { market: addresses.childMarkets[0], name: "Greta Gerwig" },
  { market: addresses.childMarkets[1], name: "Denis Villeneuve" },
] as const;

/** The connected account, as wagmi reports it; `set` notifies subscribers as a disconnect would. */
const account = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let address: string | undefined;
  return {
    get: () => address,
    set(next: string | undefined) {
      address = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
});

vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
/* The factory cannot reference imports, so GATEWAY's value is restated. */
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://cdn.example.link/ipfs" }));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

vi.mock("wagmi", async (importOriginal) => {
  const { DEFAULT_CHAIN_ID } = await import("@/config/chains");
  const { useSyncExternalStore } = await import("react");
  return {
    ...(await importOriginal<typeof import("wagmi")>()),
    useAccount: () => {
      const address = useSyncExternalStore(account.subscribe, account.get);
      return address ? { address, chainId: DEFAULT_CHAIN_ID } : { address: undefined, chainId: undefined };
    },
  };
});

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

// As the real query does with no holder: skipped, so it stays pending with no data.
vi.mock("@/features/trade-executor/api/getFunds", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/trade-executor/api/getFunds")>()),
  useFunds: (holder: Address | undefined, token: Address | undefined) => {
    if (!holder) return { data: undefined, isPending: true };
    const own = holder.toLowerCase() === OWNER;
    return { data: { native: 0n, token: token ? (own ? 10n * WAD : 0n) : null }, isPending: false };
  },
}));

vi.mock("@/features/predict/api/getSavingsRate", () => ({
  useSavingsRate: (sDai: Address | undefined) =>
    sDai ? { data: (5n * 10n ** 18n) / 4n, isPending: false } : { data: undefined, isPending: true },
}));

vi.mock("../useHasPredicted", () => ({ useHasPredicted: () => false }));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));

const driver = {
  start: vi.fn<PredictDriver["start"]>(),
  recover: vi.fn<PredictDriver["recover"]>(),
  resume: vi.fn<PredictDriver["resume"]>(),
  retry: vi.fn<PredictDriver["retry"]>(),
  reset: vi.fn<PredictDriver["reset"]>(),
  dispose: vi.fn<PredictDriver["dispose"]>(),
  subscribe: vi.fn<PredictDriver["subscribe"]>(() => () => {}),
  getProgress: vi.fn<PredictDriver["getProgress"]>(),
} satisfies PredictDriver;

const idle: PredictProgress = { stage: "idle", steps: [], skipped: [], batchesDone: 0, batches: 0 };

vi.mock("@/features/predict/hooks/usePredictRun", () => ({
  usePredictRun: (input: unknown) => ({ driver: input ? driver : null, progress: idle }),
}));

function renderPage() {
  const detail = toSessionDetail(
    {
      ...sessionDetailColumns,
      children: OPTIONS.map((option, index) =>
        sessionChildRow({ id: option.market, displayName: option.name, parentOutcomeIndex: String(index) }),
      ),
    },
    GATEWAY,
  );
  for (const option of OPTIONS) useEstimateStore.getState().setEstimate(detail.parentMarket, option.market, 312);
  const marketEstimates = Object.fromEntries(OPTIONS.map((option) => [option.market, 250]));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <PredictCard session={detail} status="trading" marketEstimates={marketEstimates} />
    </QueryClientProvider>,
  );
}

async function openPopup() {
  await userEvent.click(screen.getByRole("button", { name: "Predict selected" }));
  return within(await screen.findByRole("dialog"));
}

// PredictCard loads PredictRunner with next/dynamic on first open; importing it here keeps its
// first load out of the first test's timeout.
beforeAll(async () => {
  await import("../PredictRunner");
});

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  useEstimateStore.setState({ estimates: {} });
  account.set(OWNER);
});

describe("the balance line when the wallet disconnects with the popup open", () => {
  it("asks for a wallet instead of checking the balance forever", async () => {
    renderPage();
    const popup = await openPopup();
    expect(await popup.findByText("Balance: 10 sDAI")).toBeInTheDocument();

    act(() => account.set(undefined));

    expect(await popup.findByText("Connect a wallet to see your balance")).toBeInTheDocument();
    expect(popup.queryByText("Checking your balance…")).toBeNull();
    expect(popup.queryByText(/^Balance: /)).toBeNull();
  });

  it("shows the balance again once a wallet reconnects", async () => {
    renderPage();
    const popup = await openPopup();
    await popup.findByText("Balance: 10 sDAI");

    act(() => account.set(undefined));
    await popup.findByText("Connect a wallet to see your balance");
    act(() => account.set(OWNER));

    expect(await popup.findByText("Balance: 10 sDAI")).toBeInTheDocument();
    expect(popup.queryByText("Connect a wallet to see your balance")).toBeNull();
  });
});

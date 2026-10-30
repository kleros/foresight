import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { owner } from "@/features/liquidity/api/__tests__/support/chain";
import type { LiquidityProgress } from "@/features/liquidity/types";
import { sessionStatsKey } from "@/features/sessions/api/getSessionStats";
import { sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { MarketPage } from "../../../MarketPage";
import { createWorld, graphqlFor, sessionLoaded, TRADING_CLOSE } from "../support";

const current = vi.hoisted(() => ({
  world: undefined as unknown as { client: unknown },
}));
vi.mock("@/lib/web3/public-client", () => ({
  get publicClient() {
    return current.world.client;
  },
}));
vi.mock("@/config/chains", async (importOriginal) => {
  const { gnosis } = await import("viem/chains");
  return {
    ...(await importOriginal<typeof import("@/config/chains")>()),
    DEFAULT_CHAIN_ID: 100,
    DEFAULT_CHAIN: gnosis,
  };
});
vi.mock("@/features/sessions/api/verifySession", () => ({
  verifySession: async (_client: unknown, _chain: number, row: unknown) => row,
}));
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://cdn.example.link/ipfs" }));
vi.mock("@/features/trade-executor/components/TradeWallet/TradeWallet", () => ({ TradeWallet: () => null }));
vi.mock("@/app/market/[parentMarket]/_components/useOptionPositions", () => ({ useOptionPositions: () => ({}) }));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: owner, chainId: 100, isConnected: true, status: "connected" }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

/** The liquidity run the page builds, held at a stage the test moves; nothing is signed. */
const driver = vi.hoisted(() => {
  let progress: LiquidityProgress = { stage: "idle", rows: [], signatures: { done: 0, total: 0 } };
  const listeners = new Set<() => void>();
  return {
    moveTo(stage: LiquidityProgress["stage"]) {
      progress = { ...progress, stage };
      for (const listener of listeners) listener();
    },
    port: {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getProgress: () => progress,
      recover: () => {},
      dispose: () => {},
    },
  };
});
vi.mock("@/features/liquidity/run/driver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/liquidity/run/driver")>()),
  createLiquidityRun: () => driver.port,
}));

// the page reads the session, then the pools, then the positions, each a round trip through the fake chain
vi.setConfig({ testTimeout: 20_000 });

const STATS_KEY = sessionStatsKey(sessionDetailColumns.id);

beforeEach(() => {
  vi.mocked(fetchGraphql).mockReset();
  window.history.replaceState(null, "", "/");
});

describe("the market header after a liquidity run on the same page", () => {
  it("reads the session's stats and pool balances again once the run completes", async () => {
    const world = createWorld();
    current.world = world;
    vi.mocked(fetchGraphql).mockImplementation(graphqlFor(world, TRADING_CLOSE) as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MarketPage parentMarket={world.parentMarket} />
      </QueryClientProvider>,
    );
    await sessionLoaded();
    const reads = () =>
      client
        .getQueryCache()
        .findAll({ queryKey: STATS_KEY, type: "active" })
        .map((query) => query.state.dataUpdateCount);
    // the stats, then the pool balances keyed under them
    await waitFor(() => expect(reads()).toEqual([1, 1]));

    act(() => driver.moveTo("complete"));

    await waitFor(() => expect(reads()).toEqual([2, 2]));
  });
});

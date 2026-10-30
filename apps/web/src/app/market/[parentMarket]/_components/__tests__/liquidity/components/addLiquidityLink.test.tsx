import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { DocumentNode } from "graphql";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { owner } from "@/features/liquidity/api/__tests__/support/chain";
import { sessionKey } from "@/features/sessions/api/getSession";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { ADD_LIQUIDITY_PARAM } from "@/config/paths";

import { MarketPage } from "../../../MarketPage";
import { createWorld, graphqlFor, liquidityDialog, sessionLoaded, TRADING_CLOSE } from "../support";

const current = vi.hoisted(() => ({
  world: undefined as unknown as { client: unknown },
  account: { address: undefined as string | undefined, chainId: 100, isConnected: false, status: "disconnected" },
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
  useAccount: () => current.account,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

const fetchMock = vi.mocked(fetchGraphql);

// the page reads the session, then the pools, each a round trip through the fake chain
vi.setConfig({ testTimeout: 20_000 });

const SETUP_REASON = "The session is still being set up.";

beforeEach(() => {
  fetchMock.mockReset();
  current.account = { address: owner, chainId: 100, isConnected: true, status: "connected" };
  window.history.replaceState(null, "", `/?${ADD_LIQUIDITY_PARAM}`);
});

describe("the add-liquidity link on a session still being set up", () => {
  it("opens the liquidity popup once the session's setup completes", async () => {
    const world = createWorld();
    current.world = world;
    const answer = graphqlFor(world, TRADING_CLOSE);
    let settingUp = true;
    fetchMock.mockImplementation((async (document: DocumentNode) => {
      const result = (await answer(document)) as { Session?: Record<string, unknown>[] };
      if (!settingUp || !result.Session) return result;
      return { Session: result.Session.map((row) => ({ ...row, completedAt: "0" })) };
    }) as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MarketPage parentMarket={world.parentMarket} />
      </QueryClientProvider>,
    );
    await sessionLoaded();
    await waitFor(() => expect(screen.getByText(SETUP_REASON)).toBeVisible(), { timeout: 5000 });
    expect(screen.queryByRole("dialog", { name: /liquidity/i })).toBeNull();

    settingUp = false;
    await client.invalidateQueries({ queryKey: sessionKey(world.parentMarket) });

    expect(await liquidityDialog()).toBeInTheDocument();
  });
});

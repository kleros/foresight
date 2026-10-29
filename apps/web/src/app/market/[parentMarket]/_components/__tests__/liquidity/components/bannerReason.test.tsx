import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { createPublicClient, custom, RpcRequestError } from "viem";
import { gnosis } from "viem/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { owner } from "@/features/liquidity/api/__tests__/support/chain";
import { liquidityKeyPrefix } from "@/features/liquidity/api/getLiquidityPools";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { MarketPage } from "../../../MarketPage";
import { addControls, createWorld, graphqlFor, sessionLoaded, TRADING_CLOSE, type World } from "../support";

const current = vi.hoisted(() => ({
  client: undefined as unknown,
  account: { address: undefined as string | undefined, chainId: 100, isConnected: false, status: "disconnected" },
}));
vi.mock("@/lib/web3/public-client", () => ({
  get publicClient() {
    return current.client;
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

vi.setConfig({ testTimeout: 20_000 });

const Q96 = 2n ** 96n;
const POOLS_UNREAD = "Could not read the pools. Reload in a moment.";

const disabled = (element: HTMLElement) =>
  element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";

/** The world's chain, refusing every eth_call once `refusing.on` is set. */
function refusableClient(world: World) {
  const refusing = { on: false };
  const client = createPublicClient({
    chain: gnosis,
    transport: custom({
      async request(args: { method: string; params?: unknown }) {
        if (refusing.on && args.method === "eth_call") {
          throw new RpcRequestError({ body: args, error: { code: -32000, message: "node down" }, url: "fake" });
        }
        return world.client.request(args as never);
      },
    }),
    batch: { multicall: true },
  });
  return { client, refusing };
}

beforeEach(() => {
  fetchMock.mockReset();
  current.account = { address: owner, chainId: 100, isConnected: true, status: "connected" };
  window.history.replaceState(null, "", "/");
});

describe("the no-liquidity banner when a later read of the pools fails", () => {
  it("disables its Add liquidity with the pools-unreadable reason, as the section's", async () => {
    const world = createWorld();
    const [first] = world.branches as [World["branches"][0]];
    world.setPool(first.upToken, first.outcome, { sqrtPriceX96: Q96, liquidity: 0n, tickSpacing: 60 });
    const { client, refusing } = refusableClient(world);
    current.client = client;
    fetchMock.mockImplementation(graphqlFor(world, TRADING_CLOSE) as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MarketPage parentMarket={world.parentMarket} />
      </QueryClientProvider>,
    );
    await sessionLoaded();
    await waitFor(() => expect(addControls()).toHaveLength(2), { timeout: 5000 });
    expect(addControls().map(disabled)).toEqual([false, false]);

    refusing.on = true;
    await act(() => queryClient.refetchQueries({ queryKey: [...liquidityKeyPrefix, "pools"] }));

    await waitFor(() => expect(screen.getAllByText(POOLS_UNREAD)).toHaveLength(2), { timeout: 5000 });
    expect(screen.getByText("No liquidity yet")).toBeVisible();
    const [banner, section] = addControls() as [HTMLElement, HTMLElement];
    expect(disabled(banner)).toBe(true);
    expect(banner).toHaveAccessibleDescription(POOLS_UNREAD);
    expect(disabled(section)).toBe(true);
    expect(section).toHaveAccessibleDescription(POOLS_UNREAD);
  });
});

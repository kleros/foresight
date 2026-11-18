import type { ReactNode } from "react";

import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { owner, sortPair } from "@/features/liquidity/api/__tests__/support/chain";
import { fullRange } from "@/features/liquidity/flow/__tests__/support/session";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { executorAddress } from "@/lib/trade-executor/executor";

import { tradeExecutorFactoryAddress } from "@/config/contracts";

import {
  BRANCH_NAMES,
  createWorld,
  graphqlFor,
  renderMarketPage,
  sessionLoaded,
  TRADING_CLOSE,
  WAD,
  type World,
} from "../support";

const current = vi.hoisted(() => ({
  world: undefined as unknown as { client: unknown },
  executor: {} as { data?: unknown; isError?: boolean; refetch?: () => unknown },
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
vi.mock("wagmi", async (importOriginal) => {
  const { owner: connected } = await import("@/features/liquidity/api/__tests__/support/chain");
  return {
    ...(await importOriginal<typeof import("wagmi")>()),
    useAccount: () => ({ address: connected, chainId: 100, isConnected: true, status: "connected" }),
  };
});
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
// the fake chain answers no factory read, so the trade wallet's state is given here
vi.mock("@/features/trade-executor/api/getExecutor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/trade-executor/api/getExecutor")>()),
  useExecutor: () => current.executor,
}));

// the page reads the session, then the pools, then the positions, each a round trip through the fake chain
vi.setConfig({ testTimeout: 20_000 });

const Q96 = 2n ** 96n;
const tradeWallet = executorAddress(tradeExecutorFactoryAddress(100)!, owner);

/** A world whose only position is the trade wallet's, in the first branch's UP pool. */
function heldByTradeWallet() {
  const world = createWorld();
  const [first] = world.branches as [World["branches"][0]];
  world.setPool(first.upToken, first.outcome, { sqrtPriceX96: Q96, liquidity: 10n * WAD, tickSpacing: 60 });
  const [token0, token1] = sortPair(first.upToken, first.outcome);
  world.holdPosition(tradeWallet, { tokenId: 8n, token0, token1, ...fullRange(60), liquidity: WAD });
  current.world = world;
  vi.mocked(fetchGraphql).mockImplementation(graphqlFor(world, TRADING_CLOSE) as never);
  return world;
}

beforeEach(() => {
  vi.mocked(fetchGraphql).mockReset();
  window.history.replaceState(null, "", "/");
});

describe("the market page's trade wallet positions", () => {
  it("lists a position only the deployed trade wallet holds, with a Remove from the trade wallet", async () => {
    current.executor = { data: { predicted: tradeWallet, deployed: tradeWallet }, isError: false, refetch: vi.fn() };
    renderMarketPage(heldByTradeWallet());
    await sessionLoaded();

    await userEvent.click(await screen.findByRole("button", { name: "Your positions" }, { timeout: 8000 }));
    const dialog = await screen.findByRole("dialog", { name: "Your positions" });
    expect(within(dialog).getByText(/In your trade wallet/)).toBeTruthy();
    expect(
      within(dialog).getByRole("button", {
        name: new RegExp(`^Remove ${BRANCH_NAMES[0]} UP pool from your trade wallet, `),
      }),
    ).toBeTruthy();
  });

  it("says the positions could not be read when the trade wallet's state cannot be, and reads it again", async () => {
    const refetch = vi.fn();
    current.executor = { data: undefined, isError: true, refetch };
    renderMarketPage(heldByTradeWallet());
    await sessionLoaded();

    expect(await screen.findByText("Your positions could not be read.", {}, { timeout: 8000 })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Read again" }));
    expect(refetch).toHaveBeenCalled();
  });
});

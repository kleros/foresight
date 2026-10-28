import type { ReactNode } from "react";

import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { owner } from "@/features/liquidity/api/__tests__/support/chain";
import { fetchLiquidityPools } from "@/features/liquidity/api/getLiquidityPools";
import { sqrtPriceForBps } from "@/features/liquidity/flow/math";
import { planSeed } from "@/features/liquidity/flow/plan";
import type { PoolState } from "@/features/liquidity/types";

import { fetchGraphql } from "@/lib/graphql/batcher";

import {
  createWorld,
  expectShown,
  fields,
  graphqlFor,
  isLocked,
  openDialog,
  renderMarketPage,
  S_DAI,
  sessionLoaded,
  setField,
  TRADING_CLOSE,
  valueOf,
  WAD,
  type World,
} from "../support";

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

// the page reads the session, then the pools, then the positions, each a round trip through the fake chain
vi.setConfig({ testTimeout: 20_000 });

const T = 37n * WAD;

const childIsToken0 = (child: string, outcome: string) => BigInt(child) < BigInt(outcome);

/**
 * Branch 0: UP pool missing, DOWN pool initialized empty at 0.2. Branch 1: UP pool live at exactly 0.4,
 * DOWN pool missing. The wallet holds 100 sDAI.
 */
function mixedWorld(): World {
  const world = createWorld();
  const [first, second] = world.branches as [World["branches"][0], World["branches"][0]];
  world.setPool(first.downToken, first.outcome, {
    sqrtPriceX96: sqrtPriceForBps(2_000n, childIsToken0(first.downToken, first.outcome)),
    liquidity: 0n,
    tickSpacing: 60,
  });
  world.setPool(second.upToken, second.outcome, {
    sqrtPriceX96: sqrtPriceForBps(4_000n, childIsToken0(second.upToken, second.outcome)),
    liquidity: 10n * WAD,
    tickSpacing: 60,
  });
  world.setBalance(S_DAI, 100n * WAD);
  return world;
}

/** Neither branch's pools hold liquidity: one is empty, the rest are missing. */
function unseededWorld(): World {
  const world = createWorld();
  const [first] = world.branches as [World["branches"][0]];
  world.setPool(first.upToken, first.outcome, {
    sqrtPriceX96: sqrtPriceForBps(3_000n, childIsToken0(first.upToken, first.outcome)),
    liquidity: 0n,
    tickSpacing: 60,
  });
  world.setBalance(S_DAI, 100n * WAD);
  return world;
}

async function openPopup(world: World) {
  current.world = world;
  fetchMock.mockImplementation(graphqlFor(world, TRADING_CLOSE) as never);
  renderMarketPage(world);
  await sessionLoaded();
  await waitFor(() => expect(screen.queryAllByRole("button", { name: /^add liquidity$/i }).length).toBeGreaterThan(0), {
    timeout: 5000,
  });
  return openDialog();
}

async function enterTotal(dialog: HTMLElement, total: string) {
  const [field] = fields(dialog, /total/i);
  expect(field, "a Total field").toBeDefined();
  await setField(field!, total);
}

beforeEach(() => {
  fetchMock.mockReset();
  current.account = { address: owner, chainId: 100, isConnected: true, status: "connected" };
  window.history.replaceState(null, "", "/");
});

describe("the liquidity popup's form", () => {
  it("takes the total in sDAI or xDAI", async () => {
    const dialog = await openPopup(mixedWorld());

    expect(fields(dialog, /total/i)).toHaveLength(1);
    expect(dialog).toHaveTextContent(/sDAI/);
    expect(dialog).toHaveTextContent(/xDAI/);
  });

  it("gives every branch a depth of the total and an UP price of 0.5 where no pool holds liquidity", async () => {
    const dialog = await openPopup(unseededWorld());
    await enterTotal(dialog, "37");

    await waitFor(() => expect(fields(dialog, /depth/i).map(valueOf)).toEqual([37, 37]));
    const prices = fields(dialog, /price/i);
    expect(prices).toHaveLength(2);
    for (const price of prices) {
      expect([0.5, 50]).toContain(valueOf(price));
      expect(isLocked(price)).toBe(false);
    }
    expect(dialog).not.toHaveTextContent(/\blocked\b/i);
  });

  it("locks the UP price of a branch whose pool holds liquidity to that pool's price, and says so", async () => {
    const dialog = await openPopup(mixedWorld());
    await enterTotal(dialog, "37");

    const [free, locked] = fields(dialog, /price/i) as [HTMLElement, HTMLElement];
    await waitFor(() => expect(isLocked(locked)).toBe(true));
    expect([0.4, 40]).toContain(valueOf(locked));
    expect(isLocked(free)).toBe(false);
    expect([0.5, 50]).toContain(valueOf(free));
    expect(dialog).toHaveTextContent(/lock/i);
  });

  it("lets a branch's depth go down from the total", async () => {
    const dialog = await openPopup(mixedWorld());
    await enterTotal(dialog, "37");

    const second = fields(dialog, /depth/i)[1]!;
    await setField(second, "23");

    await waitFor(() => expect(fields(dialog, /depth/i).map(valueOf)).toEqual([37, 23]));
  });

  it("never seeds a branch deeper than the total", async () => {
    const dialog = await openPopup(mixedWorld());
    await enterTotal(dialog, "37");

    const first = fields(dialog, /depth/i)[0]!;
    await setField(first, "40");

    const submit = within(dialog).queryAllByRole("button", { name: /^(add|seed) liquidity$|^add$|^seed$/i });
    const refused =
      valueOf(fields(dialog, /depth/i)[0]!) <= 37 ||
      (submit.length > 0 &&
        submit.every((button) => button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true"));
    expect(refused).toBe(true);
  });
});

describe("what the liquidity popup says a seed does", () => {
  async function planned(world: World, depths: [bigint, bigint]) {
    const pools = await fetchLiquidityPools(world.client, world.markets);
    const branchPools: { up: PoolState; down: PoolState }[] = pools.branches;
    return planSeed({
      session: pools.session,
      owner,
      total: T,
      collateral: "sDAI",
      chainTime: world.chainTime,
      branches: [
        { depth: depths[0], upPriceBps: 5_000n, pools: branchPools[0]! },
        { depth: depths[1], upPriceBps: 4_000n, pools: branchPools[1]! },
      ],
    });
  }

  it("shows, per pool, both tokens it receives", async () => {
    const world = mixedWorld();
    const dialog = await openPopup(world);
    await enterTotal(dialog, "37");
    await setField(fields(dialog, /depth/i)[1]!, "23");
    const plan = await planned(world, [T, 23n * WAD]);

    await waitFor(() => {
      plan.branches.forEach((branch, index) => {
        for (const side of ["up", "down"] as const) {
          expectShown(dialog, branch.pools[side].amount0, `branch ${index} ${side} pool token0`);
          expectShown(dialog, branch.pools[side].amount1, `branch ${index} ${side} pool token1`);
        }
      });
    });
  });

  it("shows what stays in the wallet: the unused outcome tokens, the INVALIDs and the dust", async () => {
    const world = mixedWorld();
    const dialog = await openPopup(world);
    await enterTotal(dialog, "37");
    await setField(fields(dialog, /depth/i)[1]!, "23");
    const plan = await planned(world, [T, 23n * WAD]);
    const [, second] = world.branches as [World["branches"][0], World["branches"][0]];
    const kept = (token: string) => plan.leftovers.find((each) => each.token.toLowerCase() === token.toLowerCase());

    // 37 of branch 1's outcome minted, 23 of it used
    expect(kept(second.outcome)?.amount).toBeGreaterThan(13n * WAD);
    await waitFor(() => {
      expectShown(dialog, kept(second.outcome)!.amount, "branch 1's unused outcome tokens");
      expectShown(dialog, kept(world.parentInvalid)!.amount, "the parent INVALID");
      for (const branch of world.branches) {
        expectShown(dialog, kept(branch.invalidToken)!.amount, "a branch's INVALID");
      }
    });
    expect(dialog).toHaveTextContent(/dust|rounding/i);
  });

  it("lists the steps to sign in the timeline: the parent split and each branch's seed at least", async () => {
    const dialog = await openPopup(mixedWorld());
    await enterTotal(dialog, "37");

    await waitFor(() =>
      expect(within(dialog).queryAllByRole("listitem", { name: /^Timeline item/ }).length).toBeGreaterThanOrEqual(3),
    );
  });
});

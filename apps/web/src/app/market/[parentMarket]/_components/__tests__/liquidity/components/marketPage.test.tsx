import type { ReactNode } from "react";

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { owner, sortPair } from "@/features/liquidity/api/__tests__/support/chain";
import { fetchLiquidityPools } from "@/features/liquidity/api/getLiquidityPools";
import { fullRange } from "@/features/liquidity/flow/__tests__/support/session";
import { planMerge } from "@/features/liquidity/flow/plan";

import { fetchGraphql } from "@/lib/graphql/batcher";

import {
  addControls,
  BRANCH_NAMES,
  createWorld,
  expectShown,
  graphqlFor,
  liquidityDialog,
  PAST_CLOSE,
  precedes,
  renderMarketPage,
  S_DAI,
  sessionLoaded,
  TRADING_CLOSE,
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

const Q96 = 2n ** 96n;
const { tickLower, tickUpper } = fullRange(60);

/** No pool of the session holds liquidity: branch 0's UP pool is initialized empty, the rest are missing. */
function unseeded(): World {
  const world = createWorld();
  const [first] = world.branches as [World["branches"][0]];
  world.setPool(first.upToken, first.outcome, { sqrtPriceX96: Q96, liquidity: 0n, tickSpacing: 60 });
  return world;
}

/** Branch 0's UP pool and branch 1's DOWN pool are live, the wallet holding a position in each. */
function seeded(): World {
  const world = createWorld();
  const [first, second] = world.branches as [World["branches"][0], World["branches"][0]];
  world.setPool(first.upToken, first.outcome, { sqrtPriceX96: Q96, liquidity: 10n * WAD, tickSpacing: 60 });
  world.setPool(second.downToken, second.outcome, { sqrtPriceX96: Q96, liquidity: 10n * WAD, tickSpacing: 60 });
  const [a0, a1] = sortPair(first.upToken, first.outcome);
  const [b0, b1] = sortPair(second.downToken, second.outcome);
  world.holdPosition(owner, { tokenId: 7n, token0: a0, token1: a1, tickLower, tickUpper, liquidity: WAD });
  world.holdPosition(owner, { tokenId: 9n, token0: b0, token1: b1, tickLower, tickUpper, liquidity: 2n * WAD });
  return world;
}

/**
 * Complete sets in the wallet: branch 0 merges 2.5 to its outcome, branch 1 merges 4.5; with 0.75 of branch 0's
 * outcome already held, every parent outcome comes to at least 3.25, which merges to 3.25 sDAI.
 */
function holdCompleteSets(world: World) {
  const [first, second] = world.branches as [World["branches"][0], World["branches"][0]];
  const set = (token: `0x${string}`, hundredths: bigint) => world.setBalance(token, (hundredths * WAD) / 100n);
  set(first.upToken, 250n);
  set(first.downToken, 300n);
  set(first.invalidToken, 250n);
  set(first.outcome, 75n);
  set(second.upToken, 500n);
  set(second.downToken, 450n);
  set(second.invalidToken, 450n);
  set(world.parentInvalid, 1_000n);
  world.setBalance(S_DAI, 0n);
}

function show(world: World, openingTime: string) {
  current.world = world;
  fetchMock.mockImplementation(graphqlFor(world, openingTime) as never);
  renderMarketPage(world);
  return sessionLoaded();
}

const removeButtons = () => screen.queryAllByRole("button", { name: /^remove/i });
const mergeButton = () => screen.findByRole("button", { name: /^merge/i }, { timeout: 5000 });
const predictButton = () => screen.getByRole("button", { name: /^Predict (\d+ )?estimates?$/ });
const optionHeading = (index: number) => screen.getAllByRole("heading", { name: BRANCH_NAMES[index] })[0]!;

const disabled = (element: HTMLElement) =>
  element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";

beforeEach(() => {
  fetchMock.mockReset();
  current.account = { address: owner, chainId: 100, isConnected: true, status: "connected" };
  window.history.replaceState(null, "", "/");
});

describe("the market page of a session with no liquidity", () => {
  it("puts a banner with Add liquidity above the options, and the liquidity section below them", async () => {
    await show(unseeded(), TRADING_CLOSE);

    await waitFor(() => expect(addControls()).toHaveLength(2), { timeout: 5000 });
    const [banner, section] = addControls() as [HTMLElement, HTMLElement];
    expect(precedes(banner, optionHeading(0))).toBe(true);
    expect(precedes(optionHeading(1), section)).toBe(true);
    expect(precedes(predictButton(), section)).toBe(true);
  });

  it("opens the liquidity popup from the banner", async () => {
    await show(unseeded(), TRADING_CLOSE);
    await waitFor(() => expect(addControls()).toHaveLength(2), { timeout: 5000 });

    await userEvent.click(addControls()[0]!);

    expect(await liquidityDialog()).toBeInTheDocument();
  });

  it("lists a position in a pool that reads as empty, with its Remove", async () => {
    const world = createWorld();
    const [first] = world.branches as [World["branches"][0]];
    world.setPool(first.upToken, first.outcome, { sqrtPriceX96: Q96, liquidity: 0n, tickSpacing: 60 });
    const [token0, token1] = sortPair(first.upToken, first.outcome);
    // above the pool's tick 0, so the pool's active liquidity stays 0
    world.holdPosition(owner, { tokenId: 11n, token0, token1, tickLower: 600, tickUpper: 1_200, liquidity: WAD });

    await show(world, TRADING_CLOSE);

    const remove = await screen.findByRole("button", { name: `Remove ${BRANCH_NAMES[0]} UP pool` }, { timeout: 5000 });
    expect(disabled(remove)).toBe(false);
  });
});

describe("the market page of a session with liquidity", () => {
  it("shows no banner, only the section's Add liquidity below the options", async () => {
    await show(seeded(), TRADING_CLOSE);
    await waitFor(() => expect(removeButtons()).toHaveLength(2), { timeout: 5000 });

    const controls = addControls();
    expect(controls).toHaveLength(1);
    expect(precedes(optionHeading(1), controls[0]!)).toBe(true);
    expect(precedes(predictButton(), controls[0]!)).toBe(true);
  });

  it("lists each of the wallet's positions with its own Remove, in the section", async () => {
    await show(seeded(), TRADING_CLOSE);

    await waitFor(() => expect(removeButtons()).toHaveLength(2), { timeout: 5000 });
    const [add] = addControls() as [HTMLElement];
    for (const remove of removeButtons()) {
      expect(precedes(predictButton(), remove)).toBe(true);
      expect(disabled(remove)).toBe(false);
    }
    expect(add).toBeInTheDocument();
  });

  it("offers the merge after the positions, showing exactly what it returns", async () => {
    const world = seeded();
    holdCompleteSets(world);
    const pools = await fetchLiquidityPools(world.client, world.markets);
    const plan = planMerge({
      session: pools.session,
      owner,
      balances: {
        branches: [
          { outcome: (75n * WAD) / 100n, up: (250n * WAD) / 100n, down: 3n * WAD, invalid: (250n * WAD) / 100n },
          { outcome: 0n, up: 5n * WAD, down: (450n * WAD) / 100n, invalid: (450n * WAD) / 100n },
        ],
        parentInvalid: 10n * WAD,
      },
    });
    expect(plan.parentMerge).toBe((325n * WAD) / 100n);

    await show(world, TRADING_CLOSE);
    const merge = await mergeButton();
    await waitFor(() => expect(removeButtons()).toHaveLength(2), { timeout: 5000 });

    for (const remove of removeButtons()) expect(precedes(remove, merge)).toBe(true);
    const section = merge.closest("section") ?? document.body;
    await waitFor(() => {
      expectShown(section, plan.branches[0]!.merge, "branch 0's merge");
      expectShown(section, plan.branches[1]!.merge, "branch 1's merge");
      expectShown(section, plan.parentMerge, "the sDAI the parent merge returns");
    });
  });

  it("keeps the section for a visitor with no wallet", async () => {
    current.account = { address: undefined, chainId: 100, isConnected: false, status: "disconnected" };

    await show(seeded(), TRADING_CLOSE);

    await waitFor(() => expect(addControls()).toHaveLength(1), { timeout: 5000 });
    expect(precedes(predictButton(), addControls()[0]!)).toBe(true);
  });
});

describe("the market page after the session's close", () => {
  it("disables every Add liquidity control with the reason, banner and section alike", async () => {
    await show(unseeded(), PAST_CLOSE);

    await waitFor(() => expect(addControls()).toHaveLength(2), { timeout: 5000 });
    for (const control of addControls()) {
      expect(disabled(control)).toBe(true);
      expect(control).toHaveAccessibleDescription(/clos/i);
    }
  });

  it("keeps Remove and Merge while Add is disabled", async () => {
    const world = seeded();
    holdCompleteSets(world);

    await show(world, PAST_CLOSE);

    const merge = await mergeButton();
    await waitFor(() => expect(removeButtons()).toHaveLength(2), { timeout: 5000 });
    expect(disabled(merge)).toBe(false);
    for (const remove of removeButtons()) expect(disabled(remove)).toBe(false);
    const [add] = addControls() as [HTMLElement];
    expect(disabled(add)).toBe(true);
    expect(add).toHaveAccessibleDescription(/clos/i);
  });
});

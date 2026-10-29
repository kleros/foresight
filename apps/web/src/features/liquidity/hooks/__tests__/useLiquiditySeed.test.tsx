import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { branch, owner, session, userSqrtPrice } from "../../flow/__tests__/support/session";
import { MAX_SEED_PRICE_BPS } from "../../oracle/tolerances";
import type { PoolState, SessionPools } from "../../types";
import { useLiquiditySeed } from "../useLiquiditySeed";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

const WAD = 10n ** 18n;
// branch(1): the UP token sorts before the outcome, the DOWN token after it
const live = (bps: bigint, childIsToken0: boolean): PoolState => ({
  status: "live",
  sqrtPriceX96: userSqrtPrice(bps, childIsToken0),
  liquidity: 10n ** 21n,
  tickSpacing: 60,
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

function seedWith(down: PoolState) {
  const pools: SessionPools = { session: session([branch(1)]), branches: [{ up: live(5_000n, true), down }] };
  return renderHook(
    () =>
      useLiquiditySeed({
        pools,
        owner,
        names: ["Movie A"],
        balances: {
          branches: [{ outcome: 0n, up: 0n, down: 0n, invalid: 0n }],
          parentInvalid: 0n,
          collateral: 100n * WAD,
          native: 100n * WAD,
        },
        chainTime: 1_900_000_000n,
        closed: false,
        form: { total: "10", collateral: "sDAI", depths: [], prices: [] },
      }),
    { wrapper },
  ).result.current;
}

describe("useLiquiditySeed with live pools of a branch", () => {
  it("offers nothing to sign while the DOWN pool's own price is outside the seed range, and says why", () => {
    const seed = seedWith(live(MAX_SEED_PRICE_BPS + 500n, false));

    expect(seed.problem).toMatch(/DOWN pool's own price is outside/);
    expect(seed.request).toBeUndefined();
  });

  it("offers the seed when both pools' own prices sit in the range", () => {
    const seed = seedWith(live(5_000n, false));

    expect(seed.problem).toBeUndefined();
    expect(seed.request?.kind).toBe("seed");
  });
});

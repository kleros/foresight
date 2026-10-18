import { describe, expect, it } from "vitest";

import type { PoolLiquidity } from "@/types/pool";

import { MAX_BUY_BUDGET_SHARE_BPS, SLIPPAGE_BPS } from "../../oracle/tolerances";
import {
  buyBudgetShareBps,
  MIN_LEG_WEI,
  planBuys,
  planSells,
  LEG_HEADROOM_BPS,
  previewTrades,
  type OptionTarget,
  type SwapLeg,
} from "../plan";

const WAD = 10n ** 18n;

/** Sqrt prices exact at X96, so a volume to target is a round number. */
const AT = { "0.0625": 2n ** 94n, "0.25": 2n ** 95n, "1": 2n ** 96n } as const;

const pool = (sqrtPriceX96: bigint, liquidity = WAD): PoolLiquidity => ({
  sqrtPriceX96,
  tick: 0,
  liquidity,
  fee: 0n,
  ticks: [],
  outcomeIsToken0: true,
});

/** Each leg's side and size, leaving its limit to the tests about limits. */
const sized = (legs: SwapLeg[]) => legs.map(({ side, amountIn }) => ({ side, amountIn }));

/** Deep enough that a leg is never capped by the pool, only by the budget. */
const DEEP = 10n ** 30n;

const option = (overrides: Partial<OptionTarget> = {}): OptionTarget => ({
  pools: { up: pool(AT["1"]), down: pool(AT["0.25"], DEEP) },
  targetPriceWad: WAD / 4n,
  held: { up: 0n, down: 0n, invalid: 0n },
  splitAmount: WAD,
  ...overrides,
});

describe("planSells", () => {
  it("sells the side the market holds above the estimate", () => {
    // UP sits at 1 and the estimate puts it at 0.25, so UP sells and DOWN does not
    const legs = planSells(option());

    expect(sized(legs)).toEqual([{ side: "up", amountIn: 1000000000000000000n }]);
  });

  it("sells no more than the executor will hold", () => {
    const legs = planSells(option({ splitAmount: WAD / 4n }));

    expect(sized(legs)).toEqual([{ side: "up", amountIn: 250000000000000000n }]);
  });

  it("counts what the executor already holds alongside the split", () => {
    const legs = planSells(option({ held: { up: WAD / 4n, down: 0n, invalid: 0n }, splitAmount: WAD / 4n }));

    expect(sized(legs)).toEqual([{ side: "up", amountIn: 500000000000000000n }]);
  });

  it("drops a leg too small to be worth its gas", () => {
    expect(planSells(option({ splitAmount: MIN_LEG_WEI - 1n }))).toEqual([]);
    expect(sized(planSells(option({ splitAmount: MIN_LEG_WEI })))).toEqual([{ side: "up", amountIn: MIN_LEG_WEI }]);
  });

  it("sells both sides when the two pools disagree with the estimate the same way", () => {
    const legs = planSells(option({ pools: { up: pool(AT["1"]), down: pool(AT["1"]) }, targetPriceWad: WAD / 4n }));

    expect(legs.map((leg) => leg.side)).toEqual(["up", "down"]);
  });

  it("leaves a pool that never priced alone, whichever side of it the outcome is", () => {
    const asToken1 = { sqrtPriceX96: 0n, liquidity: WAD, tick: 0, fee: 0n, ticks: [], outcomeIsToken0: false };

    expect(planSells(option({ pools: { up: asToken1, down: pool(AT["1"]) } })).map((leg) => leg.side)).toEqual([
      "down",
    ]);
  });

  it("leaves a pool that never priced alone", () => {
    const legs = planSells(option({ pools: { up: pool(0n), down: pool(AT["1"]) } }));

    expect(legs.map((leg) => leg.side)).toEqual(["down"]);
  });
});

describe("the limit on each leg", () => {
  it("stops a sell at the target and expects what selling down to it pays", () => {
    const [leg] = planSells(option());

    // UP falls from 1 to the 0.25 target, so sqrtP 1 to 0.5: x rises 1e18 to 2e18, y falls 1e18 to 0.5e18
    expect(leg).toEqual({
      side: "up",
      amountIn: WAD,
      limitSqrtPrice: AT["0.25"],
      amountInAtLimit: WAD,
      amountOutAtLimit: WAD / 2n,
    });
  });

  it("stops a buy at the target and expects what buying up to it returns", () => {
    const rising = option({ pools: { up: pool(AT["0.0625"]), down: pool(AT["1"]) }, targetPriceWad: WAD / 4n });

    const { legs } = planBuys(rising, [{ side: "down", amountIn: WAD, underlyingOut: WAD * 10n }], SLIPPAGE_BPS);

    // UP climbs 0.0625 to 0.25, so sqrtP 0.25 to 0.5: x falls 4e18 to 2e18, y rises 0.25e18 to 0.5e18
    expect(legs).toEqual([
      {
        side: "up",
        // a hundredth of headroom on top of the 0.25 the pool needs
        amountIn: ((WAD / 4n) * 101n) / 100n,
        limitSqrtPrice: AT["0.25"],
        amountInAtLimit: WAD / 4n,
        amountOutAtLimit: WAD * 2n,
      },
    ]);
  });

  it("stops a sell at the target's own sqrt price, never short of it", () => {
    // 0.3 has no exact sqrt price, so a sell has to round its limit up to stay at or above it
    const target = (WAD * 3n) / 10n;
    const [leg] = planSells(option({ targetPriceWad: target }));

    expect(leg!.limitSqrtPrice * leg!.limitSqrtPrice * WAD).toBeGreaterThanOrEqual(target * AT["1"] * AT["1"]);
    expect((leg!.limitSqrtPrice - 1n) * (leg!.limitSqrtPrice - 1n) * WAD).toBeLessThan(target * AT["1"] * AT["1"]);
  });

  it("expects a sell offered headroom to spend only what reaching the target takes", () => {
    // 2 UP held covers the 1 UP the pool takes to fall to 0.25, plus the headroom
    const [leg] = planSells(option({ splitAmount: WAD * 2n }));

    expect(leg).toEqual({
      side: "up",
      amountIn: (WAD * 101n) / 100n,
      limitSqrtPrice: AT["0.25"],
      amountInAtLimit: WAD,
      amountOutAtLimit: WAD / 2n,
    });
  });

  it("expects a sell its balance cuts short to still need the whole way to the target", () => {
    const [leg] = planSells(option({ splitAmount: WAD / 4n }));

    expect(leg).toEqual({
      side: "up",
      amountIn: WAD / 4n,
      limitSqrtPrice: AT["0.25"],
      amountInAtLimit: WAD,
      amountOutAtLimit: WAD / 2n,
    });
  });

  it("offers the headroom on a sell the balance covers", () => {
    const [leg] = planSells(option({ splitAmount: WAD * 2n }));

    expect(leg!.amountIn).toBe((WAD * 101n) / 100n);
  });
});

describe("planBuys", () => {
  it("spends the sells' proceeds on the side being bought", () => {
    const plan = planBuys(option(), [{ side: "up", amountIn: WAD, underlyingOut: (WAD * 4n) / 10n }], SLIPPAGE_BPS);

    // the whole UP balance went, so nothing pairs off: 0.4 proceeds at 98 of 100
    expect(plan.mergeAmount).toBe(0n);
    expect(sized(plan.legs)).toEqual([{ side: "down", amountIn: (((WAD * 4n) / 10n) * 98n) / 100n }]);
  });

  it("merges the pairs left over and spends those too", () => {
    const plan = planBuys(option(), [{ side: "up", amountIn: WAD / 2n, underlyingOut: WAD / 5n }], SLIPPAGE_BPS);

    // 0.5 UP and 1 DOWN remain, so 0.5 merges back; 0.2 + 0.5 at 98 of 100
    expect(plan.mergeAmount).toBe(WAD / 2n);
    expect(sized(plan.legs)).toEqual([{ side: "down", amountIn: ((WAD / 5n + WAD / 2n) * 98n) / 100n }]);
  });

  it("keeps back more of the budget when the slippage setting is wider", () => {
    const plan = planBuys(option(), [{ side: "up", amountIn: WAD, underlyingOut: (WAD * 4n) / 10n }], 300);

    // 0.4 proceeds, less 3% a sell may lose and the 1% margin: 96 of 100
    expect(sized(plan.legs)).toEqual([{ side: "down", amountIn: (((WAD * 4n) / 10n) * 96n) / 100n }]);
  });

  it("never buys with more than the sells pay when each fills at its minimum", () => {
    const both = option({
      pools: { up: pool(AT["0.25"], DEEP), down: pool(AT["0.0625"], DEEP) },
      targetPriceWad: (WAD * 75n) / 100n,
      held: { up: WAD * 3n, down: WAD, invalid: WAD },
    });

    for (const slippageBps of [0, 1, 50, 100, 300, 999, 2500]) {
      for (const sells of [
        [{ side: "up" as const, amountIn: WAD * 3n, underlyingOut: WAD + 7n }],
        [{ side: "up" as const, amountIn: WAD, underlyingOut: 333_333_333_333_333_333n }],
        [
          { side: "up" as const, amountIn: WAD, underlyingOut: (WAD * 2n) / 3n },
          { side: "up" as const, amountIn: WAD / 3n, underlyingOut: WAD / 7n },
        ],
      ]) {
        const plan = planBuys(both, sells, slippageBps);

        const worstProceeds = sells.reduce(
          (sum, leg) => sum + (leg.underlyingOut * BigInt(10_000 - slippageBps)) / 10_000n,
          0n,
        );
        const spent = plan.legs.reduce((sum, leg) => sum + leg.amountIn, 0n);
        expect(plan.legs.length).toBeGreaterThan(0);
        expect(spent).toBeLessThan(worstProceeds + plan.mergeAmount);
      }
    }
  });

  it("merges no more sets than it holds INVALID for", () => {
    const bought = option({
      pools: { up: pool(AT["1"]), down: pool(AT["0.25"], DEEP) },
      held: { up: WAD, down: WAD, invalid: WAD / 4n },
      splitAmount: 0n,
    });

    const plan = planBuys(bought, [], SLIPPAGE_BPS);

    expect(plan.mergeAmount).toBe(WAD / 4n);
  });

  it("splits the budget between two buys by how far each has to travel", () => {
    // the estimate puts UP at 0.75 and so DOWN at 0.25: UP climbs 0.5 from 0.25, DOWN climbs
    // 0.1875 from 0.0625, and 11 of collateral merges to a budget of 10.78
    const both = option({
      pools: { up: pool(AT["0.25"], DEEP), down: pool(AT["0.0625"], DEEP) },
      targetPriceWad: (WAD * 75n) / 100n,
      held: { up: WAD * 11n, down: WAD * 11n, invalid: WAD * 11n },
      splitAmount: 0n,
    });

    const plan = planBuys(both, [], SLIPPAGE_BPS);

    // 0.5 and 0.1875 of 0.6875 are 8 and 3 elevenths of the budget
    const budget = (WAD * 11n * 98n) / 100n;
    expect(sized(plan.legs)).toEqual([
      { side: "up", amountIn: (budget * 8n) / 11n },
      { side: "down", amountIn: (budget * 3n) / 11n },
    ]);
  });

  it("keeps the pool's own limit when it is the smaller of the two", () => {
    const shallow = option({
      pools: { up: pool(AT["1"]), down: pool(AT["0.25"], WAD) },
      targetPriceWad: WAD / 4n,
    });

    const plan = planBuys(shallow, [{ side: "up", amountIn: WAD, underlyingOut: WAD * 100n }], SLIPPAGE_BPS);

    // the budget dwarfs what moving DOWN from 0.25 to 0.75 actually takes
    expect(plan.legs[0]!.amountIn).toBeLessThan((WAD * 100n * 98n) / 100n);
  });

  it("does nothing for an option the market already agrees with", () => {
    const agreed = option({
      pools: { up: pool(AT["0.25"], DEEP), down: pool(0n) },
      targetPriceWad: WAD / 4n,
      held: { up: WAD, down: WAD, invalid: WAD },
      splitAmount: 0n,
    });

    const plan = planBuys(agreed, [], SLIPPAGE_BPS);

    // nothing was sold and nothing will be bought, so its pairs are left where they are
    expect(plan.legs).toEqual([]);
    expect(plan.mergeAmount).toBe(0n);
  });

  it("merges the pairs a sell leaves behind even when there is nothing to buy", () => {
    const bothSelling = option({ pools: { up: pool(AT["1"]), down: pool(AT["1"]) } });

    const plan = planBuys(bothSelling, [{ side: "up", amountIn: WAD / 2n, underlyingOut: WAD / 5n }], SLIPPAGE_BPS);

    // half the UP went, so half of what was split is still paired and comes back as underlying
    expect(plan.legs).toEqual([]);
    expect(plan.mergeAmount).toBe(WAD / 2n);
  });
});

describe("the buy budget's share of what the sells and merge return", () => {
  it("stays below what the oracle's slippage leaves", () => {
    expect(buyBudgetShareBps(SLIPPAGE_BPS)).toBeLessThan(BigInt(MAX_BUY_BUDGET_SHARE_BPS));
  });

  it("stays below what 3% slippage leaves", () => {
    expect(buyBudgetShareBps(300)).toBeLessThan(10_000n - 300n);
  });

  for (const slippageBps of [SLIPPAGE_BPS, 300]) {
    it(`is what planBuys spends of the proceeds and the merge, at ${slippageBps / 100}% slippage`, () => {
      // 0.5 UP and 1 DOWN remain after the sell, so 0.5 merges; the DOWN pool is deep enough not to cap the leg
      const plan = planBuys(option(), [{ side: "up", amountIn: WAD / 2n, underlyingOut: WAD / 5n }], slippageBps);

      expect(plan.mergeAmount).toBe(WAD / 2n);
      expect(sized(plan.legs)).toEqual([
        { side: "down", amountIn: ((WAD / 5n + WAD / 2n) * buyBudgetShareBps(slippageBps)) / 10_000n },
      ]);
    });
  }
});

describe("previewTrades", () => {
  const near = (actual: bigint, expected: bigint) =>
    expect(actual > expected ? actual - expected : expected - actual).toBeLessThan(10n ** 12n);

  it("splits what the option is given, exactly", () => {
    expect(previewTrades(option({ splitAmount: 3n * WAD }), SLIPPAGE_BPS)?.split).toBe(3n * WAD);
  });

  it("sells as much as the split holds, and expects what the pool pays down to the estimate", () => {
    // selling 1 UP into a 1-liquidity pool at sqrtP 1 lands on sqrtP 0.5: 0.5 underlying out
    const trades = previewTrades(option(), SLIPPAGE_BPS)!;

    expect(trades.sells.map(({ side, amountIn }) => ({ side, amountIn }))).toEqual([{ side: "up", amountIn: WAD }]);
    near(trades.sells[0]!.underlyingOut, WAD / 2n);
  });

  it("shows a sell the limit stops at the estimate as what reaching it takes, and merges what the run plans", () => {
    // reaching 0.25 takes 1 UP; the run sells that plus headroom and merges the rest of the 2 split
    const planned = (WAD * (10_000n + LEG_HEADROOM_BPS)) / 10_000n;
    const trades = previewTrades(option({ splitAmount: 2n * WAD }), SLIPPAGE_BPS)!;

    near(trades.sells[0]!.amountIn, WAD);
    expect(trades.sells[0]!.toTarget).toBe(true);
    expect(trades.merge).toBe(2n * WAD - planned);
    near(trades.sells[0]!.underlyingOut, WAD / 2n);
  });

  it("shows a sell the balance runs out on at its whole amount, not as reaching the estimate", () => {
    const trades = previewTrades(option({ splitAmount: WAD / 2n }), SLIPPAGE_BPS)!;

    expect(trades.sells[0]).toMatchObject({ amountIn: WAD / 2n, toTarget: false });
  });

  it("shows a buy the limit stops at the estimate as what reaching it takes", () => {
    // the DOWN sale pays far more than lifting a 1-liquidity UP pool from 0.25 to 0.5 takes
    const trades = previewTrades(
      option({
        pools: { up: pool(AT["0.25"]), down: pool(AT["1"], DEEP) },
        targetPriceWad: WAD / 2n,
        splitAmount: 50n * WAD,
      }),
      SLIPPAGE_BPS,
    )!;
    const buy = trades.buys.find((leg) => leg.side === "up")!;

    expect(buy.toTarget).toBe(true);
    near(trades.to, WAD / 2n);
  });

  it("buys with the expected proceeds and the merge, and expects what the pool returns for them", () => {
    // DOWN at 0.25 in a deep pool returns about 4 DOWN per underlying
    const trades = previewTrades(option(), SLIPPAGE_BPS)!;

    expect(trades.buys.map(({ side }) => side)).toEqual(["down"]);
    near(trades.buys[0]!.amountIn, ((WAD / 2n) * buyBudgetShareBps(SLIPPAGE_BPS)) / 10_000n);
    near(trades.buys[0]!.outcomeOut, 4n * trades.buys[0]!.amountIn);
  });

  it("moves UP to the estimate when the split covers the sell", () => {
    const trades = previewTrades(option(), SLIPPAGE_BPS);

    expect(trades?.from).toBe(WAD);
    near(trades!.to, WAD / 4n);
  });

  it("stops short of the estimate when the split runs out", () => {
    // 0.5 UP lands on sqrtP 2/3
    const trades = previewTrades(option({ splitAmount: WAD / 2n }), SLIPPAGE_BPS);

    near(trades!.to, 444444444444444444n);
  });

  it("lifts UP toward an estimate above the market with what the DOWN sale pays", () => {
    const trades = previewTrades(
      option({ pools: { up: pool(AT["0.25"]), down: pool(AT["1"]) }, targetPriceWad: WAD / 2n }),
      SLIPPAGE_BPS,
    );

    expect(trades!.to).toBeGreaterThan(trades!.from);
    expect(trades!.to).toBeLessThanOrEqual(WAD / 2n);
  });

  it("has no legs, no split and no merge for an option the market already agrees with", () => {
    const agreed = option({
      pools: { up: pool(AT["0.25"], DEEP), down: pool(0n) },
      held: { up: WAD, down: WAD, invalid: WAD },
      splitAmount: WAD,
    });

    expect(previewTrades(agreed, SLIPPAGE_BPS)).toEqual({
      split: 0n,
      sells: [],
      merge: 0n,
      buys: [],
      from: WAD / 4n,
      to: WAD / 4n,
    });
  });

  it("leaves the market where it is with nothing to trade", () => {
    const trades = previewTrades(option({ splitAmount: 0n }), SLIPPAGE_BPS);

    expect(trades).toMatchObject({ sells: [], buys: [], from: WAD, to: WAD });
  });

  it("has nothing to show for an UP pool that never priced", () => {
    expect(previewTrades(option({ pools: { up: pool(0n), down: pool(AT["0.25"]) } }), SLIPPAGE_BPS)).toBeNull();
  });
});

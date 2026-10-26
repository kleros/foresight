import { describe, expect, it } from "vitest";

import { sqrtPriceAtTick, tickAtSqrtPrice } from "@/lib/swap/tickMath";

import type { PoolLiquidity } from "@/types/pool";

import {
  isqrt,
  limitSqrtPriceX96,
  priceFromSqrtPriceX96,
  sqrtPriceX96FromPrice,
  swapToward,
  volumeUntilPrice,
} from "../poolMath";

const WAD = 10n ** 18n;
const Q96 = 2n ** 96n;

/** Sqrt prices that are exact at X96, so an expectation carries no rounding. */
const SQRT = { "0.25": 2n ** 95n, "1": 2n ** 96n, "4": 2n ** 97n } as const;

describe("isqrt", () => {
  it("is the square root of a square", () => {
    expect(isqrt(0n)).toBe(0n);
    expect(isqrt(1n)).toBe(1n);
    expect(isqrt(4n)).toBe(2n);
    expect(isqrt(2n ** 192n)).toBe(2n ** 96n);
  });

  it("rounds down between squares", () => {
    expect(isqrt(2n)).toBe(1n);
    expect(isqrt(3n)).toBe(1n);
    expect(isqrt(8n)).toBe(2n);
    expect(isqrt(15n)).toBe(3n);
    expect(isqrt(2n ** 192n - 1n)).toBe(2n ** 96n - 1n);
  });

  it("refuses a negative value", () => {
    expect(() => isqrt(-1n)).toThrow(RangeError);
  });
});

describe("priceFromSqrtPriceX96", () => {
  it("squares the sqrt price when the outcome is token0", () => {
    expect(priceFromSqrtPriceX96(SQRT["1"], true)).toBe(WAD);
    expect(priceFromSqrtPriceX96(SQRT["0.25"], true)).toBe(WAD / 4n);
  });

  it("inverts it when the outcome is token1", () => {
    expect(priceFromSqrtPriceX96(SQRT["1"], false)).toBe(WAD);
    expect(priceFromSqrtPriceX96(SQRT["4"], false)).toBe(WAD / 4n);
  });
});

describe("sqrtPriceX96FromPrice", () => {
  it("undoes priceFromSqrtPriceX96 on either side", () => {
    expect(sqrtPriceX96FromPrice(WAD / 4n, true)).toBe(SQRT["0.25"]);
    expect(sqrtPriceX96FromPrice(WAD / 4n, false)).toBe(SQRT["4"]);
  });

  it("refuses a price of zero", () => {
    expect(() => sqrtPriceX96FromPrice(0n, true)).toThrow(RangeError);
  });
});

/*
 * Expectations come from the virtual reserves a range holds: x = L / sqrtP outcome tokens against
 * y = L * sqrtP underlying. Moving the price moves both, and the differences are the trade.
 */
describe("volumeUntilPrice", () => {
  const LIQUIDITY = WAD;

  it("buys the outcome up to the target when it is token0", () => {
    // price 0.25 to 1, so sqrtP 0.5 to 1: x falls 2e18 to 1e18, y rises 0.5e18 to 1e18
    const volumes = volumeUntilPrice(
      { sqrtPriceX96: SQRT["0.25"], liquidity: LIQUIDITY, tick: 0, fee: 0n, ticks: [], outcomeIsToken0: true },
      WAD,
    );

    expect(volumes).toEqual({ outcome: 1000000000000000000n, underlying: 500000000000000000n });
  });

  it("sells the same amounts back down again", () => {
    const volumes = volumeUntilPrice(
      { sqrtPriceX96: SQRT["1"], liquidity: LIQUIDITY, tick: 0, fee: 0n, ticks: [], outcomeIsToken0: true },
      WAD / 4n,
    );

    expect(volumes).toEqual({ outcome: 1000000000000000000n, underlying: 500000000000000000n });
  });

  it("swaps which side is which when the outcome is token1", () => {
    // the outcome rising 0.25 to 1 is the pool falling 4 to 1, so sqrtP 2 to 1:
    // y falls 2e18 to 1e18 outcome, x rises 0.5e18 to 1e18 underlying
    const volumes = volumeUntilPrice(
      { sqrtPriceX96: SQRT["4"], liquidity: LIQUIDITY, tick: 0, fee: 0n, ticks: [], outcomeIsToken0: false },
      WAD,
    );

    expect(volumes).toEqual({ outcome: 1000000000000000000n, underlying: 500000000000000000n });
  });

  it("scales with the pool's liquidity", () => {
    const volumes = volumeUntilPrice(
      { sqrtPriceX96: SQRT["0.25"], liquidity: LIQUIDITY * 7n, tick: 0, fee: 0n, ticks: [], outcomeIsToken0: true },
      WAD,
    );

    expect(volumes).toEqual({ outcome: 7000000000000000000n, underlying: 3500000000000000000n });
  });

  it("asks for nothing when the market is already at the target", () => {
    const volumes = volumeUntilPrice(
      { sqrtPriceX96: SQRT["0.25"], liquidity: LIQUIDITY, tick: 0, fee: 0n, ticks: [], outcomeIsToken0: true },
      WAD / 4n,
    );

    expect(volumes).toEqual({ outcome: 0n, underlying: 0n });
  });

  it("asks for nothing from a pool that never priced", () => {
    const volumes = volumeUntilPrice(
      { sqrtPriceX96: 0n, liquidity: LIQUIDITY, tick: 0, fee: 0n, ticks: [], outcomeIsToken0: true },
      WAD,
    );

    expect(volumes).toEqual({ outcome: 0n, underlying: 0n });
  });

  it("asks for nothing from a pool with no liquidity", () => {
    const volumes = volumeUntilPrice(
      { sqrtPriceX96: SQRT["0.25"], liquidity: 0n, tick: 0, fee: 0n, ticks: [], outcomeIsToken0: true },
      WAD,
    );

    expect(volumes).toEqual({ outcome: 0n, underlying: 0n });
  });

  it("reaches the price it was asked for", () => {
    const pool = {
      sqrtPriceX96: SQRT["0.25"],
      liquidity: LIQUIDITY,
      tick: 0,
      fee: 0n,
      ticks: [],
      outcomeIsToken0: true,
    };
    const target = (WAD * 36n) / 100n;

    const { outcome } = volumeUntilPrice(pool, target);

    // x = L / sqrtP, so what the trade leaves behind says where the pool ended up
    const reserveAfter = (LIQUIDITY * Q96) / pool.sqrtPriceX96 - outcome;
    const priceAfter = priceFromSqrtPriceX96((LIQUIDITY * Q96) / reserveAfter, true);
    expect(Number(priceAfter) / 1e18).toBeCloseTo(0.36, 6);
  });
});

/** Fixed-seed prices strictly between 0 and 1, in wad. */
function prices(count: number, seed = 0x1eaf): bigint[] {
  let state = BigInt(seed);
  return Array.from({ length: count }, () => {
    state = (state * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n;
    return 10n ** 14n + (state % (WAD - 2n * 10n ** 14n));
  });
}

describe("limitSqrtPriceX96", () => {
  const cases = [true, false].flatMap((outcomeIsToken0) =>
    [true, false].map((buying) => ({ outcomeIsToken0, buying })),
  );

  /** Where the exact price at `sqrt` sits against `target`: below, at or above, with no rounding. */
  const against = (sqrt: bigint, outcomeIsToken0: boolean, target: bigint) => {
    const [price, scaled] = outcomeIsToken0
      ? [sqrt * sqrt * WAD, target * Q96 * Q96]
      : [Q96 * Q96 * WAD, target * sqrt * sqrt];
    return price < scaled ? -1 : price > scaled ? 1 : 0;
  };

  it.each(cases)("never leaves the price past the target (token0 $outcomeIsToken0, buying $buying)", (side) => {
    for (const target of prices(300)) {
      const limit = limitSqrtPriceX96(target, side.outcomeIsToken0, side.buying);
      const position = against(limit, side.outcomeIsToken0, target);

      if (side.buying) expect(position, `target ${target}`).toBeLessThanOrEqual(0);
      else expect(position, `target ${target}`).toBeGreaterThanOrEqual(0);
    }
  });

  it.each(cases)(
    "is the closest sqrt price to the target that does (token0 $outcomeIsToken0, buying $buying)",
    (side) => {
      for (const target of prices(300)) {
        const limit = limitSqrtPriceX96(target, side.outcomeIsToken0, side.buying);
        // one step further the way the swap moves the sqrt price is past the target
        const rises = side.buying === side.outcomeIsToken0;
        const position = against(rises ? limit + 1n : limit - 1n, side.outcomeIsToken0, target);

        expect(position, `target ${target}`).toBe(side.buying ? 1 : -1);
      }
    },
  );

  it("refuses a price of zero", () => {
    expect(() => limitSqrtPriceX96(0n, true, true)).toThrow(RangeError);
  });
});

describe("volumeUntilPrice across initialised ticks", () => {
  const LIQUIDITY = WAD;
  const flat = (overrides: Partial<PoolLiquidity> = {}): PoolLiquidity => ({
    sqrtPriceX96: SQRT["0.25"],
    tick: tickAtSqrtPrice(SQRT["0.25"]),
    liquidity: LIQUIDITY,
    fee: 0n,
    ticks: [],
    outcomeIsToken0: true,
    ...overrides,
  });

  /** The virtual-reserve change between two sqrt prices at one liquidity. */
  const segment = (liquidity: bigint, a: bigint, b: bigint) => {
    const [lower, upper] = a < b ? [a, b] : [b, a];
    return {
      amount0: (liquidity * Q96 * (upper - lower)) / (lower * upper),
      amount1: (liquidity * (upper - lower)) / Q96,
    };
  };

  it("adds the liquidity of a position it climbs into", () => {
    // UP buys from 0.25 to 1, and a position from tick -6000 up adds 3e18 of liquidity on the way
    const pool = flat({ ticks: [{ tick: -6000, liquidityDelta: 3n * WAD }] });
    const boundary = sqrtPriceAtTick(-6000);

    const first = segment(LIQUIDITY, SQRT["0.25"], boundary);
    const second = segment(4n * LIQUIDITY, boundary, SQRT["1"]);

    expect(volumeUntilPrice(pool, WAD)).toEqual({
      outcome: first.amount0 + second.amount0,
      underlying: first.amount1 + second.amount1,
    });
  });

  it("takes away the liquidity of a position it falls out of", () => {
    // UP sells from 1 to 0.25 through the lower edge of a 3e18 position sitting at tick -6000
    const pool = flat({
      sqrtPriceX96: SQRT["1"],
      tick: 0,
      liquidity: 4n * LIQUIDITY,
      ticks: [{ tick: -6000, liquidityDelta: 3n * WAD }],
    });
    const boundary = sqrtPriceAtTick(-6000);

    const first = segment(4n * LIQUIDITY, SQRT["1"], boundary);
    const second = segment(LIQUIDITY, boundary, SQRT["0.25"]);

    expect(volumeUntilPrice(pool, WAD / 4n)).toEqual({
      outcome: first.amount0 + second.amount0,
      underlying: first.amount1 + second.amount1,
    });
  });

  it("counts a tick the pool sits on as crossed on the way down", () => {
    // the pool reports tick -6001 at tick -6000's sqrt price, so its liquidity already left
    const atBoundary = flat({
      sqrtPriceX96: sqrtPriceAtTick(-6000),
      tick: -6001,
      ticks: [{ tick: -6000, liquidityDelta: 3n * WAD }],
    });

    expect(volumeUntilPrice(atBoundary, WAD / 4n)).toEqual(volumeUntilPrice({ ...atBoundary, ticks: [] }, WAD / 4n));
  });

  it("ignores ticks beyond the target and behind the price", () => {
    const pool = flat({
      ticks: [
        { tick: -30000, liquidityDelta: 5n * WAD },
        { tick: 6000, liquidityDelta: -5n * WAD },
      ],
    });

    expect(volumeUntilPrice(pool, WAD)).toEqual(volumeUntilPrice(flat(), WAD));
  });

  it("is unchanged by a tick that moves no liquidity, wherever it sits, but for a wei of rounding", () => {
    const target = (WAD * 81n) / 100n;
    const whole = volumeUntilPrice(flat(), target);
    for (const price of prices(50)) {
      const tick = tickAtSqrtPrice(sqrtPriceX96FromPrice(price, true));
      const split = volumeUntilPrice(flat({ ticks: [{ tick, liquidityDelta: 0n }] }), target);
      // each segment rounds down on its own
      expect(whole.outcome - split.outcome, `tick ${tick}`).toBeGreaterThanOrEqual(0n);
      expect(whole.outcome - split.outcome, `tick ${tick}`).toBeLessThanOrEqual(1n);
      expect(whole.underlying - split.underlying, `tick ${tick}`).toBeGreaterThanOrEqual(0n);
      expect(whole.underlying - split.underlying, `tick ${tick}`).toBeLessThanOrEqual(1n);
    }
  });

  it("adds the fee to the side going in, and only to it", () => {
    const FEE = 3000n;
    const net = volumeUntilPrice(flat(), WAD);
    const buying = volumeUntilPrice(flat({ fee: FEE }), WAD);

    // a buy pays underlying in; the fee comes off it before it reaches the curve
    expect(buying.outcome).toBe(net.outcome);
    expect(buying.underlying).toBe((net.underlying * 1_000_000n + 1_000_000n - FEE - 1n) / (1_000_000n - FEE));

    const selling = volumeUntilPrice(flat({ sqrtPriceX96: SQRT["1"], tick: 0, fee: FEE }), WAD / 4n);
    const netSell = volumeUntilPrice(flat({ sqrtPriceX96: SQRT["1"], tick: 0 }), WAD / 4n);
    expect(selling.underlying).toBe(netSell.underlying);
    expect(selling.outcome).toBeGreaterThan(netSell.outcome);
  });
});

/* Expectations from the same virtual reserves: buying adds y = L * dSqrtP, selling adds x = L * d(1 / sqrtP). */
describe("swapToward", () => {
  const pool = (sqrtPriceX96: bigint, fee = 0n): PoolLiquidity => ({
    sqrtPriceX96,
    liquidity: WAD,
    tick: 0,
    fee,
    ticks: [],
    outcomeIsToken0: true,
  });
  /** Within a millionth of a token: the search stops a wei of price apart, and sqrt prices round. */
  const near = (actual: bigint, expected: bigint) =>
    expect(actual > expected ? actual - expected : expected - actual).toBeLessThan(10n ** 12n);

  it("stops at the target when the amount is more than enough", () => {
    const swap = swapToward(pool(SQRT["0.25"]), WAD, 10n * WAD);

    expect(swap.priceWad).toBe(WAD);
    near(swap.amountOut, WAD);
  });

  it("buys part of the way: 0.25 underlying lifts sqrtP 0.5 to 0.75", () => {
    const swap = swapToward(pool(SQRT["0.25"]), WAD, WAD / 4n);

    near(swap.priceWad, 562500000000000000n);
    // x falls from 1 / 0.5 to 1 / 0.75
    near(swap.amountOut, 666666666666666666n);
  });

  it("sells part of the way: 0.5 outcome drops sqrtP 1 to 2/3", () => {
    const swap = swapToward(pool(SQRT["1"]), WAD / 4n, WAD / 2n);

    near(swap.priceWad, 444444444444444444n);
    near(swap.amountOut, 333333333333333333n);
  });

  it("moves less far once the fee is taken from the amount in", () => {
    const free = swapToward(pool(SQRT["0.25"]), WAD, WAD / 4n);
    const charged = swapToward(pool(SQRT["0.25"], 3000n), WAD, WAD / 4n);

    expect(charged.priceWad).toBeLessThan(free.priceWad);
    expect(charged.amountOut).toBeLessThan(free.amountOut);
  });

  it("goes further with every larger amount, never past the target, and never costs more than the amount", () => {
    for (const [start, target] of [
      [SQRT["0.25"], WAD],
      [SQRT["1"], WAD / 4n],
    ] as const) {
      const buying = target > priceFromSqrtPriceX96(start, true);
      let previous = priceFromSqrtPriceX96(start, true);
      for (let step = 1n; step <= 40n; step += 1n) {
        const amountIn = (step * WAD) / 20n;
        const swap = swapToward(pool(start, 3000n), target, amountIn);
        const volumes = volumeUntilPrice(pool(start, 3000n), swap.priceWad);

        expect(buying ? swap.priceWad >= previous : swap.priceWad <= previous).toBe(true);
        expect(buying ? swap.priceWad <= target : swap.priceWad >= target).toBe(true);
        expect(buying ? volumes.underlying : volumes.outcome).toBeLessThanOrEqual(amountIn);
        previous = swap.priceWad;
      }
    }
  });

  it("does nothing on a pool that never priced", () => {
    expect(swapToward(pool(0n), WAD, WAD)).toEqual({ priceWad: 0n, amountOut: 0n });
  });
});

import { describe, expect, it } from "vitest";

import { isqrt, priceFromSqrtPriceX96, sqrtPriceX96FromPrice, volumeUntilPrice } from "../poolMath";

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
    const volumes = volumeUntilPrice({ sqrtPriceX96: SQRT["0.25"], liquidity: LIQUIDITY, outcomeIsToken0: true }, WAD);

    expect(volumes).toEqual({ outcome: 1000000000000000000n, underlying: 500000000000000000n });
  });

  it("sells the same amounts back down again", () => {
    const volumes = volumeUntilPrice(
      { sqrtPriceX96: SQRT["1"], liquidity: LIQUIDITY, outcomeIsToken0: true },
      WAD / 4n,
    );

    expect(volumes).toEqual({ outcome: 1000000000000000000n, underlying: 500000000000000000n });
  });

  it("swaps which side is which when the outcome is token1", () => {
    // the outcome rising 0.25 to 1 is the pool falling 4 to 1, so sqrtP 2 to 1:
    // y falls 2e18 to 1e18 outcome, x rises 0.5e18 to 1e18 underlying
    const volumes = volumeUntilPrice({ sqrtPriceX96: SQRT["4"], liquidity: LIQUIDITY, outcomeIsToken0: false }, WAD);

    expect(volumes).toEqual({ outcome: 1000000000000000000n, underlying: 500000000000000000n });
  });

  it("scales with the pool's liquidity", () => {
    const volumes = volumeUntilPrice(
      { sqrtPriceX96: SQRT["0.25"], liquidity: LIQUIDITY * 7n, outcomeIsToken0: true },
      WAD,
    );

    expect(volumes).toEqual({ outcome: 7000000000000000000n, underlying: 3500000000000000000n });
  });

  it("asks for nothing when the market is already at the target", () => {
    const volumes = volumeUntilPrice(
      { sqrtPriceX96: SQRT["0.25"], liquidity: LIQUIDITY, outcomeIsToken0: true },
      WAD / 4n,
    );

    expect(volumes).toEqual({ outcome: 0n, underlying: 0n });
  });

  it("asks for nothing from a pool that never priced", () => {
    const volumes = volumeUntilPrice({ sqrtPriceX96: 0n, liquidity: LIQUIDITY, outcomeIsToken0: true }, WAD);

    expect(volumes).toEqual({ outcome: 0n, underlying: 0n });
  });

  it("asks for nothing from a pool with no liquidity", () => {
    const volumes = volumeUntilPrice({ sqrtPriceX96: SQRT["0.25"], liquidity: 0n, outcomeIsToken0: true }, WAD);

    expect(volumes).toEqual({ outcome: 0n, underlying: 0n });
  });

  it("reaches the price it was asked for", () => {
    const pool = { sqrtPriceX96: SQRT["0.25"], liquidity: LIQUIDITY, outcomeIsToken0: true };
    const target = (WAD * 36n) / 100n;

    const { outcome } = volumeUntilPrice(pool, target);

    // x = L / sqrtP, so what the trade leaves behind says where the pool ended up
    const reserveAfter = (LIQUIDITY * Q96) / pool.sqrtPriceX96 - outcome;
    const priceAfter = priceFromSqrtPriceX96((LIQUIDITY * Q96) / reserveAfter, true);
    expect(Number(priceAfter) / 1e18).toBeCloseTo(0.36, 6);
  });
});

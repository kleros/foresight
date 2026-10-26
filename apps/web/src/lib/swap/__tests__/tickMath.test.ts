import { describe, expect, it } from "vitest";

import { sqrtPriceAtTick, tickAtSqrtPrice } from "../tickMath";

const MAX_TICK = 887272;

/** A fixed-seed generator, so a failing case reruns the same. */
function ticks(count: number, seed = 0x5eed): number[] {
  let state = seed;
  return Array.from({ length: count }, () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return (state % (2 * MAX_TICK + 1)) - MAX_TICK;
  });
}

describe("sqrtPriceAtTick", () => {
  it("matches the bounds Uniswap's and Algebra's TickMath publish", () => {
    expect(sqrtPriceAtTick(0)).toBe(2n ** 96n);
    expect(sqrtPriceAtTick(-MAX_TICK)).toBe(4295128739n);
    expect(sqrtPriceAtTick(MAX_TICK)).toBe(1461446703485210103287273052203988822378723970342n);
  });

  it("is 1.0001 to the half tick, over generated ticks", () => {
    for (const tick of ticks(200)) {
      // floats are the independent oracle here: twelve significant digits are plenty
      const expected = Math.sqrt(1.0001 ** tick) * 2 ** 96;
      const actual = Number(sqrtPriceAtTick(tick));
      expect(Math.abs(actual - expected) / expected, `tick ${tick}`).toBeLessThan(1e-9);
    }
  });

  it("rises with the tick", () => {
    for (const tick of ticks(200)) {
      if (tick === MAX_TICK) continue;
      expect(sqrtPriceAtTick(tick + 1)).toBeGreaterThan(sqrtPriceAtTick(tick));
    }
  });

  it("refuses a tick past the bounds", () => {
    expect(() => sqrtPriceAtTick(MAX_TICK + 1)).toThrow(RangeError);
    expect(() => sqrtPriceAtTick(-MAX_TICK - 1)).toThrow(RangeError);
  });
});

describe("tickAtSqrtPrice", () => {
  it("returns the tick a sqrt price falls in, over generated ticks", () => {
    for (const tick of ticks(200)) {
      const at = sqrtPriceAtTick(tick);
      expect(tickAtSqrtPrice(at), `exactly at ${tick}`).toBe(tick);
      if (tick < MAX_TICK) expect(tickAtSqrtPrice(sqrtPriceAtTick(tick + 1) - 1n), `just below ${tick + 1}`).toBe(tick);
    }
  });
});

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { MAX_SEED_PRICE_BPS, MIN_SEED_PRICE_BPS } from "../../oracle/tolerances";
import { bpsForSqrtPrice, isqrt, sqrtPriceForBps } from "../math";

describe("isqrt", () => {
  it("is the largest root whose square does not pass the value", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 2n ** 256n }), (value) => {
        const root = isqrt(value);

        expect(root * root).toBeLessThanOrEqual(value);
        expect((root + 1n) * (root + 1n)).toBeGreaterThan(value);
      }),
      { seed: 20261027, numRuns: 500 },
    );
  });
});

describe("bpsForSqrtPrice", () => {
  it("reads back the basis points sqrtPriceForBps priced, either way round", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: MIN_SEED_PRICE_BPS, max: MAX_SEED_PRICE_BPS }),
        fc.boolean(),
        (bps, childIsToken0) => {
          expect(bpsForSqrtPrice(sqrtPriceForBps(bps, childIsToken0), childIsToken0)).toBe(bps);
        },
      ),
      { seed: 20261028, numRuns: 500 },
    );
  });
});

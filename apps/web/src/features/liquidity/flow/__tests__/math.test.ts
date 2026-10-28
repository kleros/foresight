import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { isqrt } from "../math";

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

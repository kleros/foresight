import { describe, it } from "vitest";

import { allocate } from "../../src/utils/bigint";

describe("allocate", () => {
  it("gives each weight its floored share and the remainder to the largest remainders, earliest first", (t) => {
    t.expect(allocate(10n, [1n, 1n, 1n])).toEqual([4n, 3n, 3n]);
    t.expect(allocate(5n, [10n, 1n])).toEqual([5n, 0n]);
    t.expect(allocate(60n, [20n, 40n])).toEqual([20n, 40n]);
  });

  it("gives a zero weight nothing and splits a negative total the same way", (t) => {
    t.expect(allocate(7n, [0n, 3n, 0n, 1n])).toEqual([0n, 5n, 0n, 2n]);
    t.expect(allocate(-10n, [1n, 1n, 1n])).toEqual([-4n, -3n, -3n]);
  });

  it("refuses weights with nothing to split by", (t) => {
    t.expect(() => allocate(1n, [0n, 0n])).toThrow(RangeError);
    t.expect(() => allocate(1n, [2n, -1n])).toThrow(RangeError);
  });
});

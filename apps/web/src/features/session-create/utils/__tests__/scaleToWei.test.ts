import { describe, expect, it } from "vitest";

import { formatWeiScientific, isNegativeAmount, scaleToWei } from "../scaleToWei";

describe("scaleToWei", () => {
  it("scales a whole number by 1e18", () => {
    expect(scaleToWei("500")).toBe(500_000_000_000_000_000_000n);
  });

  it("scales a decimal", () => {
    expect(scaleToWei("0.5")).toBe(500_000_000_000_000_000n);
  });

  it("scales the smallest representable value", () => {
    expect(scaleToWei("0.000000000000000001")).toBe(1n);
  });

  it("returns null for an empty or non-numeric string", () => {
    expect(scaleToWei("")).toBeNull();
    expect(scaleToWei("abc")).toBeNull();
  });

  it("returns null for a partly-numeric string, which parseFloat would take the front of", () => {
    expect(scaleToWei("12abc")).toBeNull();
  });

  /** Every amount lands in a `uint256`, so a negative has nowhere to go. */
  it("refuses a negative rather than scaling it", () => {
    expect(scaleToWei("-5")).toBeNull();
    expect(scaleToWei("-0.5")).toBeNull();
  });

  it("names a negative, so the reason can be shown rather than guessed at", () => {
    expect(isNegativeAmount("-5")).toBe(true);
    expect(isNegativeAmount("5")).toBe(false);
    expect(isNegativeAmount("-")).toBe(false);
    expect(isNegativeAmount("abc")).toBe(false);
  });

  describe("exponent notation, which the bound fields produce on their own", () => {
    it("scales a small exponent exactly", () => {
      expect(scaleToWei("1e-7")).toBe(100_000_000_000n);
      expect(scaleToWei(String(0.0000001))).toBe(100_000_000_000n);
    });

    it("scales a large exponent exactly", () => {
      expect(scaleToWei("1e+21")).toBe(10n ** 39n);
      expect(scaleToWei(String(1e21))).toBe(10n ** 39n);
    });

    it("keeps every digit of a mantissa", () => {
      expect(scaleToWei("1.23e-5")).toBe(12_300_000_000_000n);
      expect(scaleToWei("1.5e3")).toBe(1_500_000_000_000_000_000_000n);
    });

    it("reads a capital E the same way", () => {
      expect(scaleToWei("1E5")).toBe(scaleToWei("100000"));
    });
  });
});

describe("formatWeiScientific", () => {
  it("formats an exact power of ten", () => {
    expect(formatWeiScientific(100_000_000_000_000_000n)).toBe("1e17");
  });

  it("keeps a non-unit mantissa", () => {
    expect(formatWeiScientific(1_500_000_000_000_000_000n)).toBe("1.5e18");
  });

  it("formats zero as 0", () => {
    expect(formatWeiScientific(0n)).toBe("0");
  });
});

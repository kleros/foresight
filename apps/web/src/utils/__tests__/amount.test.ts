import { describe, expect, it } from "vitest";

import { formatAmount, parseAmount } from "../amount";

describe("parseAmount", () => {
  it("scales a decimal by the token's precision", () => {
    // 1.5 at 18 decimals
    expect(parseAmount("1.5", 18)).toBe(1_500000000000000000n);
    // 1.5 at 6 decimals
    expect(parseAmount("1.5", 6)).toBe(1_500000n);
  });

  it("rejects zero, negatives, and non-numbers", () => {
    expect(parseAmount("0", 18)).toBeNull();
    expect(parseAmount("-1", 18)).toBeNull();
    expect(parseAmount("1,5", 18)).toBeNull();
    expect(parseAmount("", 18)).toBeNull();
  });

  it("rejects more fractional digits than the token holds", () => {
    expect(parseAmount("1.1234567", 6)).toBeNull();
  });

  it("rejects exponential notation, so a caller has to write the digits out", () => {
    expect(parseAmount("1e-8", 18)).toBeNull();
    expect(parseAmount("1e+21", 18)).toBeNull();
    expect(parseAmount("0.00000001", 18)).toBe(10_000_000_000n);
  });
});

describe("formatAmount", () => {
  it("cuts the fraction without rounding and drops trailing zeros", () => {
    // 1.23456789 at 18 decimals
    expect(formatAmount(1_234567890000000000n, 18)).toBe("1.234567");
    // 2.5 at 18 decimals
    expect(formatAmount(2_500000000000000000n, 18)).toBe("2.5");
  });

  it("keeps a whole number whole", () => {
    expect(formatAmount(3_000000000000000000n, 18)).toBe("3");
    expect(formatAmount(0n, 18)).toBe("0");
  });
});

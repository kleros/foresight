import { describe, expect, it } from "vitest";

import { resolutionExample } from "../resolutionExample";
import { scaleToWei } from "../scaleToWei";

const bounds = (lower: string, upper: string) => ({ lower: scaleToWei(lower), upper: scaleToWei(upper) });

describe("resolutionExample", () => {
  it("puts the midpoint and both clamps in the unit the question is asked in", () => {
    expect(resolutionExample(bounds("0", "500"), "$M")).toEqual({
      midpoint: "250 $M",
      floor: "0 $M",
      ceiling: "500 $M",
    });
  });

  it("keeps the decimal a midpoint lands on", () => {
    expect(resolutionExample(bounds("0", "1"), "x")?.midpoint).toBe("0.5 x");
  });

  it("groups thousands, so a range wide enough to be a scale mistake reads as one", () => {
    expect(resolutionExample(bounds("0", "200000000"), "$")?.ceiling).toBe("200,000,000 $");
  });

  /** The bigint is the point: a float would have rounded this away. */
  it("keeps every digit of a bound too long for a float", () => {
    expect(resolutionExample(bounds("123456789012345678901", "123456789012345678903"), "")?.midpoint).toBe(
      "123,456,789,012,345,678,902",
    );
  });

  it("reads without a unit, which the draft may not have yet", () => {
    expect(resolutionExample(bounds("0", "500"), "")).toEqual({ midpoint: "250", floor: "0", ceiling: "500" });
  });

  it("says nothing about bounds it cannot make a range from", () => {
    expect(resolutionExample(bounds("500", "0"), "$")).toBeNull();
    expect(resolutionExample(bounds("5", "5"), "$")).toBeNull();
    expect(resolutionExample(bounds("", "500"), "$")).toBeNull();
    expect(resolutionExample(bounds("abc", "500"), "$")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { addresses } from "@/testing/fixtures";
import type { OptionScale } from "@/types/optionScale";

import { estimateDigits, estimateDirection, estimateStep, selectedEstimates, snapEstimate } from "../estimates";

const scale = (market: OptionScale["market"], name = "Option"): OptionScale => ({
  market,
  name,
  color: "#009aff",
  unit: "$M",
  lowerBound: 0,
  upperBound: 500,
});

const [FIRST, SECOND] = addresses.childMarkets;

describe("snapEstimate", () => {
  it("moves in a power of ten two orders below the scale's width", () => {
    expect(estimateStep({ lowerBound: 0, upperBound: 500 })).toBe(1);
    expect(estimateStep({ lowerBound: 0, upperBound: 10 })).toBe(0.1);
    expect(estimateStep({ lowerBound: 0, upperBound: 1 })).toBe(0.01);
    expect(estimateStep({ lowerBound: 0, upperBound: 10_000 })).toBe(100);
    expect(estimateStep({ lowerBound: 0, upperBound: 0 })).toBe(0);
  });

  it("puts a value on the scale's grid", () => {
    expect(snapEstimate(312.345, scale(FIRST))).toBe(312);
    expect(snapEstimate(312.6, scale(FIRST))).toBe(313);
    expect(snapEstimate(4321, { lowerBound: 0, upperBound: 10_000 })).toBe(4300);
    expect(snapEstimate(0.126, { lowerBound: 0, upperBound: 1 })).toBe(0.13);
  });

  it("keeps a value inside the scale's bounds", () => {
    expect(snapEstimate(600, scale(FIRST))).toBe(500);
    expect(snapEstimate(-1, scale(FIRST))).toBe(0);
  });

  it("leaves no binary debris on a fractional grid", () => {
    expect(snapEstimate(0.35, { lowerBound: 0.1, upperBound: 0.7 })).toBe(0.35);
    expect(String(snapEstimate(3.3, { lowerBound: 0, upperBound: 10 }))).toBe("3.3");
  });

  it("falls to the lower bound on a scale with no width", () => {
    expect(snapEstimate(3, { lowerBound: 0, upperBound: 0 })).toBe(0);
  });
});

describe("estimateDigits", () => {
  it("shows as many fraction digits as the grid needs", () => {
    expect(estimateDigits({ lowerBound: 0, upperBound: 500 })).toBe(0);
    expect(estimateDigits({ lowerBound: 0, upperBound: 10 })).toBe(1);
    expect(estimateDigits({ lowerBound: 0, upperBound: 1 })).toBe(2);
    expect(estimateDigits({ lowerBound: 1_000_000, upperBound: 5_000_000 })).toBe(0);
    expect(estimateDigits({ lowerBound: 0, upperBound: 0 })).toBe(0);
  });
});

describe("estimateDirection", () => {
  it("reads higher, lower, or nothing against the market", () => {
    expect(estimateDirection(320, 312)).toBe("higher");
    expect(estimateDirection(300, 312)).toBe("lower");
    expect(estimateDirection(312, 312)).toBeNull();
  });
});

describe("selectedEstimates", () => {
  const scales = [scale(FIRST, "Villeneuve"), scale(SECOND, "Gerwig")];
  const markets = { [FIRST]: 312, [SECOND]: 280 };

  it("keeps the estimates that differ from the market, in option order", () => {
    const selected = selectedEstimates(scales, { [SECOND]: 300, [FIRST]: 250 }, markets);

    expect(selected.map((s) => [s.scale.name, s.value, s.direction])).toEqual([
      ["Villeneuve", 250, "lower"],
      ["Gerwig", 300, "higher"],
    ]);
  });

  it("drops an estimate that sits exactly where the market does", () => {
    expect(selectedEstimates(scales, { [FIRST]: 312 }, markets)).toEqual([]);
  });

  it("drops an estimate on an option with no market estimate", () => {
    expect(selectedEstimates(scales, { [FIRST]: 250 }, { [SECOND]: 280 })).toEqual([]);
  });

  it("matches stored keys whatever the option address casing", () => {
    const checksummed = { ...scale(FIRST), market: FIRST.replace("0xc", "0xC") as OptionScale["market"] };

    expect(selectedEstimates([checksummed], { [FIRST]: 250 }, markets)).toHaveLength(1);
  });
});

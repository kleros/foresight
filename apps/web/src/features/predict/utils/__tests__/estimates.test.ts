import { describe, expect, it } from "vitest";

import { addresses } from "@/testing/fixtures";
import type { OptionScale } from "@/types/optionScale";

import {
  estimateDigits,
  estimateDirection,
  estimateStep,
  readTypedEstimate,
  selectedEstimates,
  snapEstimate,
} from "../estimates";

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

describe("readTypedEstimate", () => {
  it("reads a plain number, with or without the unit", () => {
    expect(readTypedEstimate("250", "$M")).toBe(250);
    expect(readTypedEstimate("250.5 $M", "$M")).toBe(250.5);
    expect(readTypedEstimate(" -3 ", null)).toBe(-3);
    expect(readTypedEstimate(".5", null)).toBe(0.5);
    expect(readTypedEstimate("55.", null)).toBe(55);
  });

  it("reads commas that group thousands", () => {
    expect(readTypedEstimate("1,500", "$M")).toBe(1500);
    expect(readTypedEstimate("4,100,000 $M", "$M")).toBe(4100000);
    expect(readTypedEstimate("1,234.5", null)).toBe(1234.5);
  });

  it("reads any other single comma as the decimal point", () => {
    expect(readTypedEstimate("55,5", "%")).toBe(55.5);
    expect(readTypedEstimate("0,5", "%")).toBe(0.5);
    expect(readTypedEstimate("7,5", "%")).toBe(7.5);
    expect(readTypedEstimate("0,45", null)).toBe(0.45);
  });

  it("reads a comma after a leading zero as the decimal point, since no grouped number starts with 0", () => {
    expect(readTypedEstimate("0,500", null)).toBe(0.5);
    expect(readTypedEstimate("4,100", "%")).toBe(4100);
  });

  it("takes a leading plus and spaces that group thousands", () => {
    expect(readTypedEstimate("+5", "%")).toBe(5);
    expect(readTypedEstimate("4 100 000 $M", "$M")).toBe(4100000);
    expect(readTypedEstimate("1 234,5", null)).toBe(1234.5);
  });

  it("refuses anything else", () => {
    for (const text of [
      ...["", " ", "abc", "0x32", "1e1", "Infinity", "1,2,3", "12,34,567", "1.2.3", "1,234,5", "-"],
      // three digits after a comma read as a group, which four digits before it cannot be
      "1234,567",
      // spaces only between groups of three
      ...["5 0", "12 34", "+-5", "++5"],
    ]) {
      expect(readTypedEstimate(text, null), text).toBeNaN();
    }
  });
});

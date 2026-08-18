import { describe, expect, it } from "vitest";

import { carriesMultiplier, findUnit, isListedUnit, UNITS } from "../units";

describe("The listed units", () => {
  it("carries no multiplier in any symbol, which is the point of listing them", () => {
    for (const unit of UNITS) {
      expect(carriesMultiplier(unit.symbol)).toBe(false);
    }
  });

  it("has no symbol Reality would read as part of the question", () => {
    for (const unit of UNITS) {
      expect(unit.symbol).not.toMatch(/[[\]"\\\s]/);
    }
  });

  it("finds a unit by its symbol, whitespace aside", () => {
    expect(findUnit(" % ")?.name).toBe("percent");
  });

  it("knows an unlisted symbol is unlisted", () => {
    expect(isListedUnit("%")).toBe(true);
    expect(isListedUnit("TWh")).toBe(false);
    expect(isListedUnit("")).toBe(false);
  });

  it("gives percent the range an answer is expected to land in", () => {
    expect(findUnit("%")?.expected).toEqual({ lower: 0, upper: 100 });
  });
});

describe("A unit that carries a multiplier", () => {
  it("names the suffixed ones, whose bounds have to be written in the same multiple", () => {
    expect(carriesMultiplier("$M")).toBe(true);
    expect(carriesMultiplier("$B")).toBe(true);
    expect(carriesMultiplier("$k")).toBe(true);
  });

  it("leaves a listed symbol alone even where it ends in one of those letters", () => {
    expect(carriesMultiplier("x")).toBe(false);
  });

  it("leaves a plain symbol alone", () => {
    expect(carriesMultiplier("TWh")).toBe(false);
    expect(carriesMultiplier("°C")).toBe(false);
  });

  it("leaves a unit whose multiplier is part of its name alone", () => {
    expect(carriesMultiplier("km")).toBe(false);
    expect(carriesMultiplier("mm")).toBe(false);
    expect(carriesMultiplier("ct")).toBe(false);
  });
});

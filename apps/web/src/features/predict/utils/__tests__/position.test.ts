import { describe, expect, it } from "vitest";

import { positionLeaning, positionWorth } from "../position";

const WAD = 10n ** 18n;
const PERCENT = { lowerBound: 0, upperBound: 100 };

describe("positionWorth", () => {
  it("pays UP the estimate's share of the scale and DOWN the rest", () => {
    // at 75 of 0-100, an UP pays 0.75 and a DOWN 0.25
    expect(positionWorth({ up: 200n * WAD, down: 40n * WAD }, 75, PERCENT)).toBe(150n * WAD + 10n * WAD);
  });

  it("measures the share from the scale's lower bound", () => {
    // 450 on 400-500 is halfway
    expect(positionWorth({ up: 10n * WAD, down: 0n }, 450, { lowerBound: 400, upperBound: 500 })).toBe(5n * WAD);
  });

  it("holds an estimate past a bound at that bound", () => {
    expect(positionWorth({ up: 10n * WAD, down: 10n * WAD }, 140, PERCENT)).toBe(10n * WAD);
    expect(positionWorth({ up: 10n * WAD, down: 0n }, -5, PERCENT)).toBe(0n);
  });
});

describe("positionLeaning", () => {
  it("leans higher holding more UP than DOWN", () => {
    expect(positionLeaning({ up: 3n, down: 1n })).toBe("higher");
  });

  it("leans lower holding more DOWN than UP", () => {
    expect(positionLeaning({ up: 1n, down: 3n })).toBe("lower");
  });

  it("leans nowhere holding as much of each", () => {
    expect(positionLeaning({ up: 2n, down: 2n })).toBeNull();
  });
});

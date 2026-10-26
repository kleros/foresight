import { describe, expect, it } from "vitest";

import { estimateToPriceWad, MAX_PRICE_WAD, MIN_PRICE_WAD, priceWadToEstimate } from "../optionPrice";

const DUNE = { lowerBound: 0, upperBound: 500 };
const OFFSET = { lowerBound: 100, upperBound: 600 };

describe("estimateToPriceWad", () => {
  it("is how far up the scale the estimate sits", () => {
    expect(estimateToPriceWad(250, DUNE)).toBe(500000000000000000n);
    expect(estimateToPriceWad(312, DUNE)).toBe(624000000000000000n);
  });

  it("measures from the lower bound, not from zero", () => {
    expect(estimateToPriceWad(350, OFFSET)).toBe(500000000000000000n);
  });

  it("holds an estimate at either bound just inside it", () => {
    expect(estimateToPriceWad(0, DUNE)).toBe(MIN_PRICE_WAD);
    expect(estimateToPriceWad(500, DUNE)).toBe(MAX_PRICE_WAD);
  });

  it("holds an estimate outside the scale at the same place", () => {
    expect(estimateToPriceWad(-40, DUNE)).toBe(MIN_PRICE_WAD);
    expect(estimateToPriceWad(900, DUNE)).toBe(MAX_PRICE_WAD);
  });

  it("is exact for a step on a fractional scale, with no float rounding in the wei", () => {
    expect(estimateToPriceWad(0.27, { lowerBound: 0, upperBound: 1 })).toBe(270000000000000000n);
    expect(estimateToPriceWad(0.000000271, { lowerBound: 0, upperBound: 0.000001 })).toBe(271000000000000000n);
  });

  it("survives an estimate small enough to stringify as exponential", () => {
    // String(5e-11) is "5e-11", which parseEther refuses
    expect(estimateToPriceWad(5e-11, { lowerBound: 0, upperBound: 1 })).toBe(MIN_PRICE_WAD);
  });

  it("falls to the lowest price on a scale with no width", () => {
    expect(estimateToPriceWad(3, { lowerBound: 0, upperBound: 0 })).toBe(MIN_PRICE_WAD);
  });
});

describe("priceWadToEstimate", () => {
  it("reads a price back as a number on the scale", () => {
    expect(priceWadToEstimate(500000000000000000n, DUNE)).toBe(250);
    expect(priceWadToEstimate(624000000000000000n, DUNE)).toBe(312);
    expect(priceWadToEstimate(500000000000000000n, OFFSET)).toBe(350);
  });

  it("returns the estimate that produced the price", () => {
    expect(priceWadToEstimate(estimateToPriceWad(312, DUNE), DUNE)).toBe(312);
  });
});

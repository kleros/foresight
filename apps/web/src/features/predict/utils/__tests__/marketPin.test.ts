import { describe, expect, it } from "vitest";

import {
  PIN_CLEARANCE_PX,
  PIN_PREFLIGHT_DROP,
  PIN_PREFLIGHT_PX,
  THUMB_RADIUS_PX,
  chipLeft,
  pinDrop,
  pinGap,
} from "../marketPin";

describe("pinDrop", () => {
  it("stays up while the chip is a whole preflight band clear of the thumb's value", () => {
    expect(pinDrop(PIN_CLEARANCE_PX + PIN_PREFLIGHT_PX)).toBe(0);
    expect(pinDrop(PIN_CLEARANCE_PX + PIN_PREFLIGHT_PX + 100)).toBe(0);
  });

  it("dips in step with the distance across the preflight band", () => {
    expect(pinDrop(PIN_CLEARANCE_PX + PIN_PREFLIGHT_PX * 0.75)).toBeCloseTo(PIN_PREFLIGHT_DROP * 0.25);
    expect(pinDrop(PIN_CLEARANCE_PX + PIN_PREFLIGHT_PX / 2)).toBeCloseTo(PIN_PREFLIGHT_DROP / 2);
    expect(pinDrop(PIN_CLEARANCE_PX + PIN_PREFLIGHT_PX * 0.25)).toBeCloseTo(PIN_PREFLIGHT_DROP * 0.75);
  });

  it("dips no further than the preflight share just outside the clearance", () => {
    expect(pinDrop(PIN_CLEARANCE_PX + 0.01)).toBeLessThanOrEqual(PIN_PREFLIGHT_DROP);
  });

  it("drops all the way once the chip is within the clearance, or overlaps", () => {
    expect(pinDrop(PIN_CLEARANCE_PX)).toBe(1);
    expect(pinDrop(0)).toBe(1);
    expect(pinDrop(-40)).toBe(1);
  });
});

describe("chipLeft", () => {
  it("centres the chip on the market's point", () => {
    expect(chipLeft({ track: 300, chip: 40 }, 0.5)).toBe(130);
  });

  it("keeps the chip on the track at either end", () => {
    expect(chipLeft({ track: 300, chip: 40 }, 0)).toBe(0);
    expect(chipLeft({ track: 300, chip: 40 }, 1)).toBe(260);
  });
});

describe("pinGap", () => {
  // a 300px track, a 60px value pill and a 40px chip
  const size = { track: 300, pill: 60, chip: 40 };

  it("is the room between the chip and the pill, which slides with the thumb across the track", () => {
    // the thumb at the middle: the pill spans 120 to 180; the market at 0.9: the chip spans 250 to 290
    expect(pinGap(size, { thumb: 0.5, market: 0.9 })).toBe(70);
    // the market at 0.1: the chip spans 10 to 50
    expect(pinGap(size, { thumb: 0.5, market: 0.1 })).toBe(70);
  });

  it("counts the thumb where it reaches past the pill's edge", () => {
    // the thumb at 0.1, its centre at 30: the pill spans 24 to 84, the thumb reaches to 30 - THUMB_RADIUS_PX
    expect(pinGap(size, { thumb: 0.1, market: 0 })).toBe(30 - THUMB_RADIUS_PX - 40);
  });

  it("is negative when the chip and the pill overlap", () => {
    expect(pinGap(size, { thumb: 0.5, market: 0.5 })).toBeLessThan(0);
  });

  it("reads the thumb on the market as overlapping before anything is measured", () => {
    expect(pinGap({ track: 0, pill: 0, chip: 0 }, { thumb: 0.4, market: 0.4 })).toBeLessThan(0);
  });

  it("reads the thumb away from the market as clear before anything is measured", () => {
    expect(pinDrop(pinGap({ track: 0, pill: 0, chip: 0 }, { thumb: 0.6, market: 0.4 }))).toBe(0);
  });
});

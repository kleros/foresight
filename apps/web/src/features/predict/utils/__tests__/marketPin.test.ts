import { describe, expect, it } from "vitest";

import { chipLeft, droppedChipLeft, fieldMaxWidth, pinDrop, pinGap } from "../marketPin";

describe("pinDrop", () => {
  // 4px of clearance and a 40px preflight band, dipping at most a fifth of the drop
  it("stays up while the chip is 44px or more clear of the thumb's value", () => {
    expect(pinDrop(44)).toBe(0);
    expect(pinDrop(144)).toBe(0);
  });

  it("dips in step with the distance across the preflight band", () => {
    expect(pinDrop(34)).toBeCloseTo(0.05);
    expect(pinDrop(24)).toBeCloseTo(0.1);
    expect(pinDrop(14)).toBeCloseTo(0.15);
  });

  it("dips a fifth of the drop just outside the clearance", () => {
    expect(pinDrop(4.01)).toBeGreaterThan(0.19);
    expect(pinDrop(4.01)).toBeLessThanOrEqual(0.2);
  });

  it("drops all the way once the chip is within the clearance, or overlaps", () => {
    expect(pinDrop(4)).toBe(1);
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
    // the thumb at 0.1, its centre at 30: the pill spans 24 to 84, the thumb's 24px circle reaches to 18
    expect(pinGap(size, { thumb: 0.1, market: 0 })).toBe(-22);
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

describe("droppedChipLeft", () => {
  const size = { track: 311, chip: 90, lower: 30, upper: 80 };

  it("centres the chip where no bound is in its way", () => {
    expect(droppedChipLeft(size, 0.5)).toBe(chipLeft(size, 0.5));
  });

  it("slides the chip clear of a bound, 4px off it, while it still spans the market's point", () => {
    // centred at 202, the chip would run to 247 over the upper bound from 231
    expect(droppedChipLeft(size, 0.65)).toBe(311 - 80 - 4 - 90);
    expect(droppedChipLeft({ ...size, upper: 120 }, 0.55)).toBe(311 - 120 - 4 - 90);
  });

  it("slides the chip clear of a bound while the market's point is within the stick's 3px of its edge", () => {
    const phone = { track: 256, chip: 46, lower: 35, upper: 35 };
    // the point at 217.6 lies 0.6px past the slid chip's right edge at 217
    expect(droppedChipLeft(phone, 0.85)).toBe(256 - 35 - 4 - 46);
    expect(droppedChipLeft(phone, 0.15)).toBe(35 + 4);
  });

  it("stays centred where clearing the bound would leave the market's point outside it", () => {
    expect(droppedChipLeft(size, 0.98)).toBe(chipLeft(size, 0.98));
    expect(droppedChipLeft(size, 0)).toBe(0);
  });
});

describe("fieldMaxWidth", () => {
  // a 300px track and a 40px chip
  const size = { track: 300, chip: 40 };

  it("keeps the field's edge 4px short of a raised chip on its right", () => {
    // the chip spans 250 to 290; the field's right edge sits at 150 + half its width
    expect(fieldMaxWidth(size, { thumb: 0.5, market: 0.9 })).toBe(192);
    expect(fieldMaxWidth(size, { thumb: 0, market: 0.9 })).toBe(246);
  });

  it("keeps the field's edge 4px short of a raised chip on its left", () => {
    // the chip spans 10 to 50; the field's left edge sits at 150 less half its width
    expect(fieldMaxWidth(size, { thumb: 0.5, market: 0.1 })).toBe(192);
    expect(fieldMaxWidth(size, { thumb: 1, market: 0.1 })).toBe(246);
  });

  it("is never narrower than the closed pill while the chip is raised", () => {
    // tracks from a 320px phone to a 1280px window, pills and chips from a short value to a long unit
    for (const track of [256, 311, 1112])
      for (const pill of [40, 72, 120])
        for (const chip of [46, 90])
          for (let thumb = 0; thumb <= 1; thumb += 0.02)
            for (let market = 0; market <= 1; market += 0.02) {
              const share = { thumb, market };
              if (pinDrop(pinGap({ track, pill, chip }, share)) === 1) continue;
              expect(fieldMaxWidth({ track, chip }, share)).toBeGreaterThan(pill);
            }
  });

  it("sets no cap before the track is measured", () => {
    expect(fieldMaxWidth({ track: 0, chip: 0 }, { thumb: 0.5, market: 0.9 })).toBe(Number.POSITIVE_INFINITY);
  });
});

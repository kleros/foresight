import { describe, expect, it } from "vitest";

import {
  branchColor,
  contrastRatio,
  getReadableTextColor,
  isLegibleBranchColor,
  nextBranchColor,
} from "../branchColor";

/** More branches than any wizard flow reaches, to cover the whole hue wheel. */
const LONG_SESSION = 200;

describe("isLegibleBranchColor", () => {
  it("accepts a saturated mid-tone", () => {
    expect(isLegibleBranchColor("#9013fe")).toBe(true);
  });

  it("rejects white", () => {
    expect(isLegibleBranchColor("#ffffff")).toBe(false);
  });

  it("rejects a near-black", () => {
    expect(isLegibleBranchColor("#1b003f")).toBe(false);
  });

  it("rejects anything that is not #rrggbb", () => {
    expect(isLegibleBranchColor("#fff")).toBe(false);
    expect(isLegibleBranchColor("9013fe")).toBe(false);
    expect(isLegibleBranchColor("#zzzzzz")).toBe(false);
  });
});

describe("getReadableTextColor", () => {
  it("puts black text on a light background", () => {
    expect(getReadableTextColor("#ffffff")).toBe("#000000");
  });

  it("puts white text on a dark background", () => {
    expect(getReadableTextColor("#000000")).toBe("#FFFFFF");
  });

  it("keeps white on a colour white reads on at AA", () => {
    // white on #7e1bd4 is 7.0:1
    expect(getReadableTextColor("#7e1bd4")).toBe("#FFFFFF");
  });

  it("puts black text on a middle colour white fails AA on", () => {
    // white on #009aff is 2.97:1, black 7.1:1
    expect(getReadableTextColor("#009aff")).toBe("#000000");
  });

  it("gives every generated branch colour text at 4.5:1 or more", () => {
    for (let index = 0; index < LONG_SESSION; index++) {
      const color = branchColor(index);
      expect(contrastRatio(color, getReadableTextColor(color))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("branchColor", () => {
  it("returns the same colour for the same index", () => {
    expect(branchColor(7)).toBe(branchColor(7));
  });

  it("returns a legible colour at every index", () => {
    for (let index = 0; index < LONG_SESSION; index++) {
      expect(isLegibleBranchColor(branchColor(index))).toBe(true);
    }
  });

  it("returns a distinct colour at every index", () => {
    const colors = Array.from({ length: LONG_SESSION }, (_, index) => branchColor(index));

    expect(new Set(colors).size).toBe(LONG_SESSION);
  });
});

describe("nextBranchColor", () => {
  it("returns the first colour when none are taken", () => {
    expect(nextBranchColor([])).toBe(branchColor(0));
  });

  it("skips the colours already taken", () => {
    expect(nextBranchColor([branchColor(0), branchColor(1)])).toBe(branchColor(2));
  });

  it("continues the sequence when the taken colours are not in order", () => {
    expect(nextBranchColor([branchColor(1), branchColor(2)])).toBe(branchColor(0));
  });

  it("returns a legible colour however many are taken", () => {
    const taken = Array.from({ length: LONG_SESSION }, (_, index) => branchColor(index));

    expect(isLegibleBranchColor(nextBranchColor(taken))).toBe(true);
  });
});

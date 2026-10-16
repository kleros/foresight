import { describe, expect, it } from "vitest";

import { formatEstimate } from "../formatEstimate";

describe("formatEstimate", () => {
  it("appends the creator's unit", () => {
    expect(formatEstimate(250, "$M")).toBe("250 $M");
  });

  it("stands alone when the option has no unit", () => {
    expect(formatEstimate(62.5, null)).toBe("62.5");
  });

  it("groups thousands", () => {
    expect(formatEstimate(500000, "$")).toBe("500,000 $");
  });

  it("rounds long fractions to two places", () => {
    expect(formatEstimate(33.3333, "%")).toBe("33.33 %");
  });

  it("shows as many places as it is asked for", () => {
    expect(formatEstimate(0.4567, null, 3)).toBe("0.457");
  });
});

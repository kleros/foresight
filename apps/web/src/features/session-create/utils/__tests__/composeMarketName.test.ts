import { describe, expect, it } from "vitest";

import { composeMarketName, resolveChildQuestion } from "../composeMarketName";

describe("composeMarketName", () => {
  it("appends the unit in square brackets", () => {
    expect(composeMarketName("If watched, what percentile score would Clément give to the movie?", "%")).toBe(
      "If watched, what percentile score would Clément give to the movie? [%]",
    );
  });

  it("returns the bare question when there is no unit", () => {
    expect(composeMarketName("Opening weekend gross if Villeneuve directs", "")).toBe(
      "Opening weekend gross if Villeneuve directs",
    );
  });

  it("ignores surrounding whitespace on the unit", () => {
    expect(composeMarketName("Question", " $M ")).toBe("Question [$M]");
  });
});

describe("resolveChildQuestion", () => {
  it("substitutes every {outcome} placeholder with the outcome label", () => {
    expect(
      resolveChildQuestion({
        template: "Opening weekend gross if {outcome} directs",
        outcomeLabel: "Gerwig",
      }),
    ).toBe("Opening weekend gross if Gerwig directs");
  });

  it("uses the per-branch override verbatim when provided", () => {
    expect(
      resolveChildQuestion({
        template: "Opening weekend gross if {outcome} directs",
        outcomeLabel: "Gerwig",
        override: "Worldwide gross for Gerwig's cut",
      }),
    ).toBe("Worldwide gross for Gerwig's cut");
  });

  it("falls back to an ellipsis when the outcome has no label yet", () => {
    expect(resolveChildQuestion({ template: "Gross if {outcome} directs", outcomeLabel: "" })).toBe(
      "Gross if … directs",
    );
  });
});

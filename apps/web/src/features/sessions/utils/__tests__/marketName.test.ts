import { describe, expect, it } from "vitest";

import { splitMarketName } from "../marketName";

describe("splitMarketName", () => {
  it("splits the unit out of a scalar market name", () => {
    expect(splitMarketName("What opening weekend would Villeneuve deliver? [$M]")).toEqual({
      question: "What opening weekend would Villeneuve deliver?",
      unit: "$M",
    });
  });

  it("accepts the unspaced form the repo's own fixtures use", () => {
    expect(splitMarketName("What percentile score?[%]")).toEqual({
      question: "What percentile score?",
      unit: "%",
    });
  });

  it("leaves the unit null when the name carries none", () => {
    expect(splitMarketName("Which director for Dune: Part Three?")).toEqual({
      question: "Which director for Dune: Part Three?",
      unit: null,
    });
  });

  it("only reads a unit off the end of the name", () => {
    expect(splitMarketName("The [redacted] question")).toEqual({
      question: "The [redacted] question",
      unit: null,
    });
  });

  it("reads the last bracket pair when the question itself contains one", () => {
    expect(splitMarketName("Score for [Movie A]? [%]")).toEqual({
      question: "Score for [Movie A]?",
      unit: "%",
    });
  });
});

import { describe, expect, it } from "vitest";

import { optionNoun, optionNounSingular } from "../optionNoun";

describe("an option noun inside a sentence", () => {
  it.each([
    ["Directors", "directors"],
    ["Movie Titles", "movie titles"],
    ["US States", "US states"],
    ["NBA Teams", "NBA teams"],
    ["AI Labs", "AI labs"],
    ["iPhones", "iPhones"],
    ["cities", "cities"],
  ])("reads %s as %s, lowering only a capitalised word", (plural, inSentence) => {
    expect(optionNoun(plural)).toBe(inSentence);
  });

  it("falls back to branches and branch when the session names none", () => {
    expect(optionNoun(null)).toBe("branches");
    expect(optionNounSingular("")).toBe("branch");
  });

  it("reads the singular alike", () => {
    expect(optionNounSingular("US State")).toBe("US state");
  });
});

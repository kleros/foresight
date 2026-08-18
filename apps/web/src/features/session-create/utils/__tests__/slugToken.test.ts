import { describe, expect, it } from "vitest";

import { slugToken, TOKEN_MAX_LENGTH } from "../slugToken";

describe("slugToken", () => {
  it("uppercases and replaces spaces with underscores", () => {
    expect(slugToken("Greta Gerwig")).toBe("GRETA_GERWIG");
  });

  it("collapses runs of non-alphanumerics into one underscore", () => {
    expect(slugToken("Part: Three")).toBe("PART_THREE");
  });

  it("strips leading and trailing separators", () => {
    expect(slugToken("  Gerwig!  ")).toBe("GERWIG");
  });

  it("caps the token at the maximum length", () => {
    const slugged = slugToken("Christopher McQuarrie");

    expect(slugged).toHaveLength(TOKEN_MAX_LENGTH);
    expect("CHRISTOPHER_MCQUARRIE".startsWith(slugged)).toBe(true);
  });

  it("returns an empty string when no character is usable", () => {
    expect(slugToken("!!! ???")).toBe("");
  });
});

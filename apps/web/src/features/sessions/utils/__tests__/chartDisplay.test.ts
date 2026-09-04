import { describe, expect, it } from "vitest";

import { shortenName, withAlpha } from "../chartDisplay";

describe("shortenName", () => {
  it("keeps a name of sixteen characters", () => {
    expect(shortenName("exactly sixteen.")).toBe("exactly sixteen.");
  });

  it("caps a longer name at twelve characters plus an ellipsis", () => {
    expect(shortenName("seventeen chars!!")).toBe("seventeen ch...");
  });
});

describe("withAlpha", () => {
  it("turns a hex colour into an rgba with the given alpha", () => {
    expect(withAlpha("#009aff", 0.2)).toBe("rgba(0, 154, 255, 0.2)");
  });
});

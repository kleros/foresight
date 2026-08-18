import { describe, expect, it } from "vitest";

import { shortHash } from "../hash";

describe("shortHash", () => {
  it("keeps the first eight characters and the last four", () => {
    expect(shortHash(`0x${"ab".repeat(32)}`)).toBe("0xababab…abab");
  });

  it("returns an empty string for no hash", () => {
    expect(shortHash(undefined)).toBe("");
  });
});

import { describe, expect, it } from "vitest";

import { GATEWAY } from "@/testing/fixtures";

import { bannerStyle } from "../bannerStyle";

describe("bannerStyle", () => {
  it("points the banner at the session's hero image", () => {
    expect(bannerStyle(`${GATEWAY}/QmHero`)).toEqual({ backgroundImage: `url("${GATEWAY}/QmHero")` });
  });

  it("stands in with the gradient axis when the session has no hero", () => {
    expect(bannerStyle(null).backgroundImage).toContain("--fs-grad-from");
  });

  it("keeps a quote in the uri from escaping the css string", () => {
    expect(bannerStyle(`${GATEWAY}/Qm"Hero`).backgroundImage).toBe(`url("${GATEWAY}/Qm\\"Hero")`);
  });
});

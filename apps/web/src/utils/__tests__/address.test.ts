import { describe, expect, it } from "vitest";

import { shortenAddress } from "../address";

describe("shortenAddress", () => {
  it("keeps the ends and elides the middle", () => {
    expect(shortenAddress("0xdCEe80927E54E243c5af17f9825ce55909D3664F")).toBe("0xdCEe...664F");
  });

  it("takes as many characters from each end as asked for", () => {
    expect(shortenAddress("0xdCEe80927E54E243c5af17f9825ce55909D3664F", 6)).toBe("0xdCEe80...D3664F");
  });

  it("leaves anything already that short alone", () => {
    expect(shortenAddress("0x1234")).toBe("0x1234");
  });
});

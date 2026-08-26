import { getAddress } from "viem";
import { describe, expect, it } from "vitest";

import { parseTokenAddress } from "../address";

describe("parseTokenAddress", () => {
  it("accepts a full address, whitespace and all", () => {
    const address = getAddress("0x00000000000000000000000000000000000000ee");

    expect(parseTokenAddress(` ${address} `)).toBe(address);
  });

  it("rejects anything short of a full address", () => {
    expect(parseTokenAddress("")).toBeNull();
    expect(parseTokenAddress("0x1234")).toBeNull();
    expect(parseTokenAddress("not an address")).toBeNull();
  });
});

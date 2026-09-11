import { gnosis, hardhat } from "viem/chains";
import { describe, expect, it } from "vitest";

import { explorerAddressUrl } from "../site";

const ADDRESS = "0x2bb7B842BB6d678730A6d63910CAd47f01AF98A4";

describe("explorerAddressUrl", () => {
  it("points at the chain's own explorer", () => {
    expect(explorerAddressUrl(ADDRESS, gnosis)).toBe(`https://gnosisscan.io/address/${ADDRESS}`);
  });

  it("gives nothing on a chain with no explorer, which is every local node", () => {
    expect(explorerAddressUrl(ADDRESS, hardhat)).toBeUndefined();
  });

  it("does not double the slash where the explorer url carries a trailing one", () => {
    const chain = { blockExplorers: { default: { url: "https://gnosisscan.io/" } } };

    expect(explorerAddressUrl(ADDRESS, chain)).toBe(`https://gnosisscan.io/address/${ADDRESS}`);
  });
});

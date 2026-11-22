import { describe, expect, it } from "vitest";

import { predictBlocker } from "../predictBlocker";

const MARKET = "0xaaaa000000000000000000000000000000000001";

describe.each(["resolved", "unknown"] as const)("predictBlocker under status %s", (status) => {
  it.each([
    ["a stored run", { hasStoredRun: true }],
    ["no wallet", { isConnected: false, selectedCount: 1 }],
    ["no liquidity", { hasLiquidity: false }],
    ["unknown market numbers", { isMarketUnknown: true }],
    ["an estimate ready to predict", { selectedCount: 1 }],
  ])("names the status ahead of %s", (_name, overrides) => {
    expect(
      predictBlocker({
        status,
        options: [{ market: MARKET }],
        marketEstimates: { [MARKET]: 312 },
        isMarketUnknown: false,
        selectedCount: 0,
        isConnected: true,
        ...overrides,
      }),
    ).toBe(status);
  });
});

import { describe, expect, it } from "vitest";

import { predictBlocker } from "../predictBlocker";

const LIQUID = "0xAaAa000000000000000000000000000000000001";
const DRY = "0xbbbb000000000000000000000000000000000002";

const blocker = (marketEstimates: Record<string, number | undefined>) =>
  predictBlocker({
    status: "trading",
    options: [{ market: LIQUID }, { market: DRY }],
    marketEstimates,
    isMarketUnknown: false,
    selectedCount: 0,
    isConnected: true,
  });

describe("predictBlocker with nothing selected", () => {
  it("asks for an estimate to move when one option of several has liquidity", () => {
    expect(blocker({ [LIQUID.toLowerCase()]: 312 })).toBe("no-move");
  });

  it("reports no liquidity only when no option has any", () => {
    expect(blocker({})).toBe("no-liquidity");
  });

  it("matches a mixed-case market to its lower-case market estimate", () => {
    expect(blocker({ [LIQUID.toLowerCase()]: 312, [DRY]: undefined })).toBe("no-move");
  });
});

describe("predictBlocker with an estimate moved", () => {
  const moved = (isConnected: boolean) =>
    predictBlocker({
      status: "trading",
      options: [{ market: LIQUID }],
      marketEstimates: { [LIQUID.toLowerCase()]: 312 },
      isMarketUnknown: false,
      selectedCount: 1,
      isConnected,
    });

  it("asks for a wallet when none is connected", () => {
    expect(moved(false)).toBe("disconnected");
  });

  it("has nothing to say with a wallet connected", () => {
    expect(moved(true)).toBeNull();
  });
});

describe("predictBlocker over pools that hold no liquidity", () => {
  const empty = (overrides: Partial<Parameters<typeof predictBlocker>[0]> = {}) =>
    predictBlocker({
      status: "trading",
      options: [{ market: LIQUID }],
      // an empty pool still has the price it was initialized at
      marketEstimates: { [LIQUID.toLowerCase()]: 312 },
      isMarketUnknown: false,
      selectedCount: 1,
      isConnected: true,
      hasLiquidity: false,
      ...overrides,
    });

  it("reports no liquidity once an estimate is moved", () => {
    expect(empty()).toBe("no-liquidity");
  });

  it("reports no liquidity rather than asking for an estimate to move", () => {
    expect(empty({ selectedCount: 0 })).toBe("no-liquidity");
  });

  it("reports no liquidity before asking for a wallet", () => {
    expect(empty({ isConnected: false })).toBe("no-liquidity");
  });

  it("asks for an estimate to move over the same prices once a pool holds liquidity", () => {
    expect(empty({ selectedCount: 0, hasLiquidity: true })).toBe("no-move");
  });
});

describe("predictBlocker with an unfinished run stored", () => {
  const stored = (overrides: Partial<Parameters<typeof predictBlocker>[0]> = {}) =>
    predictBlocker({
      status: "trading",
      options: [{ market: LIQUID }],
      marketEstimates: { [LIQUID.toLowerCase()]: 312 },
      isMarketUnknown: false,
      selectedCount: 1,
      isConnected: true,
      hasStoredRun: true,
      ...overrides,
    });

  it("asks for the run to be resumed or discarded once an estimate is moved", () => {
    expect(stored()).toBe("unfinished");
  });

  it("names the run before an unmoved estimate or a market still loading", () => {
    expect(stored({ selectedCount: 0 })).toBe("unfinished");
    expect(stored({ isMarketUnknown: true })).toBe("unfinished");
  });

  it("still says trading has closed first", () => {
    expect(stored({ status: "closed" })).toBe("closed");
  });
});

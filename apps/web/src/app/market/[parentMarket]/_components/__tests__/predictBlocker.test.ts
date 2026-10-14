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

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

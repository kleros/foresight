import { describe, expect, it } from "vitest";

import { quotesShort, shownLegs, type PreviewTrades, type QuotedLeg } from "../plan";

/** One percent, in hundredths of a percent. */
const TOLERANCE_BPS = 100;

/** The popup showed: sell 1000 UP for 400 underlying, then buy 2000 DOWN with 600 underlying. */
const shown: PreviewTrades = {
  split: 0n,
  sells: [{ side: "up", amountIn: 1000n, toTarget: true, fee: 0n, underlyingOut: 400n }],
  merge: 0n,
  buys: [{ side: "down", amountIn: 600n, toTarget: true, fee: 0n, outcomeOut: 2000n }],
  from: 0n,
  to: 0n,
  feeValue: 0n,
};

const sell = (amountOut: bigint): QuotedLeg => ({ side: "up", amountIn: 1000n, amountOut });
const buy = (amountIn: bigint, amountOut: bigint): QuotedLeg => ({ side: "down", amountIn, amountOut });

describe("quotesShort", () => {
  it("passes quotes that pay what was shown", () => {
    expect(quotesShort(shownLegs(shown), { sells: [sell(400n)], buys: [buy(600n, 2000n)] }, TOLERANCE_BPS)).toBe(false);
  });

  it("passes a sell that pays 1% less than shown, the tolerance itself", () => {
    expect(quotesShort(shownLegs(shown), { sells: [sell(396n)], buys: [buy(600n, 2000n)] }, TOLERANCE_BPS)).toBe(false);
  });

  it("stops a sell that pays more than 1% less underlying than shown", () => {
    expect(quotesShort(shownLegs(shown), { sells: [sell(395n)], buys: [buy(600n, 2000n)] }, TOLERANCE_BPS)).toBe(true);
  });

  it("stops a buy that pays more than 1% fewer outcome tokens than shown", () => {
    expect(quotesShort(shownLegs(shown), { sells: [sell(400n)], buys: [buy(600n, 1979n)] }, TOLERANCE_BPS)).toBe(true);
  });

  it("passes a buy that pays 1% fewer outcome tokens than shown, the tolerance itself", () => {
    expect(quotesShort(shownLegs(shown), { sells: [sell(400n)], buys: [buy(600n, 1980n)] }, TOLERANCE_BPS)).toBe(false);
  });

  it("stops a buy that spends more than 1% less underlying than shown", () => {
    expect(quotesShort(shownLegs(shown), { sells: [sell(400n)], buys: [buy(593n, 2000n)] }, TOLERANCE_BPS)).toBe(true);
  });

  it("passes a buy that spends 1% less underlying than shown, the tolerance itself", () => {
    expect(quotesShort(shownLegs(shown), { sells: [sell(400n)], buys: [buy(594n, 2000n)] }, TOLERANCE_BPS)).toBe(false);
  });

  it("leaves a quoted leg the plan shown does not have to the other checks", () => {
    const upBuy: QuotedLeg = { side: "up", amountIn: 1n, amountOut: 1n };
    const downSell: QuotedLeg = { side: "down", amountIn: 1n, amountOut: 1n };

    expect(
      quotesShort(shownLegs(shown), { sells: [sell(400n), downSell], buys: [buy(600n, 2000n), upBuy] }, TOLERANCE_BPS),
    ).toBe(false);
  });

  it("stops when a buy the plan shown has dropped out of the quoted plan", () => {
    expect(quotesShort(shownLegs(shown), { sells: [sell(400n)], buys: [] }, TOLERANCE_BPS)).toBe(true);
  });

  it("stops when a sell the plan shown has dropped out of the quoted plan", () => {
    expect(quotesShort(shownLegs(shown), { sells: [], buys: [buy(600n, 2000n)] }, TOLERANCE_BPS)).toBe(true);
  });
});

describe("quote matching boundaries", () => {
  it("matches sell quotes by side rather than response order", () => {
    expect(
      quotesShort(
        shownLegs({ ...shown, buys: [] }),
        { sells: [{ side: "down", amountIn: 1000n, amountOut: 999n }, sell(300n)], buys: [] },
        TOLERANCE_BPS,
      ),
    ).toBe(true);
  });
  it("compares a zero-input shown leg without dividing by zero", () => {
    expect(
      quotesShort(
        shownLegs({ ...shown, sells: [{ ...shown.sells[0]!, amountIn: 0n }], buys: [] }),
        { sells: [sell(400n)], buys: [] },
        TOLERANCE_BPS,
      ),
    ).toBe(false);
  });
  it("accepts a proportionally smaller sell without any buys", () => {
    expect(
      quotesShort(
        shownLegs({ ...shown, buys: [] }),
        { sells: [{ side: "up", amountIn: 500n, amountOut: 200n }], buys: [] },
        TOLERANCE_BPS,
      ),
    ).toBe(false);
  });
  it("accepts a fully paid buy without any sells", () => {
    expect(
      quotesShort(shownLegs({ ...shown, sells: [] }), { sells: [], buys: [buy(600n, 2000n)] }, TOLERANCE_BPS),
    ).toBe(false);
  });
});

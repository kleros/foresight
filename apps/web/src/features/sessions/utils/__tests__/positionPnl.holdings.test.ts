import { parseEther, type Address } from "viem";
import { describe, expect, it } from "vitest";

import type { TradeOption } from "../../types";
import { optionPnl } from "../positionPnl";

const e = (amount: string) => parseEther(amount);

/** One prediction's slice in an option: an outright buy of `upDelta` UP or `downDelta` DOWN for `paid`. */
const slice = (paid: bigint, upDelta: bigint, downDelta: bigint): TradeOption => ({
  childMarket: "0x0000000000000000000000000000000000000001" as Address,
  downDelta,
  upDelta,
  downBalance: downDelta,
  upBalance: upDelta,
  downSwapUnderlying: upDelta === 0n ? -paid : 0n,
  downSwapTokens: downDelta,
  upSwapUnderlying: upDelta === 0n ? 0n : -paid,
  upSwapTokens: upDelta,
  downAvgPrice: null,
  upAvgPrice: null,
  downPriceBefore: null,
  downPriceAfter: null,
  upPriceBefore: null,
  upPriceAfter: null,
});

const spot = { up: e("0.3"), down: e("0.7") };

describe("optionPnl against the wallet's holdings", () => {
  it("is unavailable when the wallet holds less UP than its predictions net", () => {
    // the predictions net 10 UP; 4 left by plain transfer
    const result = optionPnl({ predictions: [slice(e("2.6"), e("10"), 0n)], held: { up: e("6"), down: 0n }, spot });

    expect(result).toMatchObject({ available: false });
  });

  it("is unavailable when the wallet holds less DOWN than its predictions net", () => {
    const result = optionPnl({ predictions: [slice(e("6"), 0n, e("10"))], held: { up: 0n, down: e("3") }, spot });

    expect(result).toMatchObject({ available: false });
  });

  it("stays available when only the pool of a side the wallet does not hold is unpriced", () => {
    // 10 UP paid 2.6, worth 3
    const result = optionPnl({
      predictions: [slice(e("2.6"), e("10"), 0n)],
      held: { up: e("10"), down: 0n },
      spot: { up: e("0.3"), down: null },
    });

    expect(result).toMatchObject({ available: true, cost: e("2.6"), value: e("3"), pnl: e("0.4") });
  });

  it("stays available when only the UP pool is unpriced and the wallet holds DOWN alone", () => {
    // 10 DOWN paid 6, worth 7
    const result = optionPnl({
      predictions: [slice(e("6"), 0n, e("10"))],
      held: { up: 0n, down: e("10") },
      spot: { up: null, down: e("0.7") },
    });

    expect(result).toMatchObject({ available: true, cost: e("6"), value: e("7"), pnl: e("1") });
  });
});

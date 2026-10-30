import fc from "fast-check";
import { parseEther, type Address } from "viem";
import { describe, expect, it } from "vitest";

import type { TradeOption } from "../../types";
import { avgEntry } from "../positionPnl";

const ONE = 10n ** 18n;
const e = (amount: string) => parseEther(amount);

/** A slice that swapped only UP: `tokens` positive for a buy, negative for a sell; avg price as the indexer sets it. */
const upSwap = (tokens: bigint, underlying: bigint): TradeOption => ({
  childMarket: "0x0000000000000000000000000000000000000001" as Address,
  underlyingDelta: underlying,
  downDelta: 0n,
  upDelta: tokens,
  downBalance: 0n,
  upBalance: 0n,
  downSwapUnderlying: 0n,
  downSwapTokens: 0n,
  upSwapUnderlying: underlying,
  upSwapTokens: tokens,
  downAvgPrice: null,
  upAvgPrice: ((underlying < 0n ? -underlying : underlying) * ONE) / (tokens < 0n ? -tokens : tokens),
  downPriceBefore: null,
  downPriceAfter: null,
  upPriceBefore: null,
  upPriceAfter: null,
});

describe("avgEntry", () => {
  it("weights each buy's price by the tokens it bought and ignores sells", () => {
    // 10 at 0.2 and 30 at 0.4: (2 + 12) / 40 = 0.35; the sell at 0.9 does not move it
    const predictions = [upSwap(e("10"), -e("2")), upSwap(e("30"), -e("12")), upSwap(-e("5"), e("4.5"))];

    expect(avgEntry(predictions, "up")).toBe(e("0.35"));
  });

  it("is null for a side that was never bought", () => {
    expect(avgEntry([upSwap(-e("5"), e("1"))], "up")).toBeNull();
    expect(avgEntry([upSwap(e("5"), -e("1"))], "down")).toBeNull();
  });

  it("lies between the cheapest and dearest buy", () => {
    const buy = fc
      .record({ tokens: fc.bigInt({ min: 1n, max: 10n ** 24n }), underlying: fc.bigInt({ min: 1n, max: 10n ** 24n }) })
      .map(({ tokens, underlying }) => upSwap(tokens, -underlying));
    fc.assert(
      fc.property(fc.array(buy, { minLength: 1, maxLength: 6 }), (predictions) => {
        const prices = predictions.map((each) => each.upAvgPrice!);
        const result = avgEntry(predictions, "up")!;

        expect(result >= prices.reduce((a, b) => (a < b ? a : b))).toBe(true);
        expect(result <= prices.reduce((a, b) => (a > b ? a : b))).toBe(true);
      }),
      { seed: 20_261_030 },
    );
  });
});

import fc from "fast-check";
import { parseEther } from "viem";
import { describe, expect, it } from "vitest";

import { addresses } from "@/testing/fixtures";
import type { OptionScale } from "@/types/optionScale";

import type { TradeOption } from "../../types";
import { estimateAt, setsMinted, sideSwaps } from "../tradeDetail";

const option = (overrides: Partial<TradeOption> = {}): TradeOption => ({
  childMarket: addresses.childMarkets[0]!,
  underlyingDelta: 0n,
  downDelta: 0n,
  upDelta: 0n,
  downBalance: 0n,
  upBalance: 0n,
  downSwapUnderlying: 0n,
  downSwapTokens: 0n,
  upSwapUnderlying: 0n,
  upSwapTokens: 0n,
  downAvgPrice: null,
  upAvgPrice: null,
  downPriceBefore: null,
  downPriceAfter: null,
  upPriceBefore: null,
  upPriceAfter: null,
  ...overrides,
});

const SCALE: OptionScale = {
  market: addresses.childMarkets[0]!,
  name: "Greta Gerwig",
  color: "#000",
  unit: "$M",
  lowerBound: 100,
  upperBound: 500,
};

const wei = fc.bigInt({ min: 1n, max: 10n ** 24n });
const signedWei = fc.bigInt({ min: -(10n ** 24n), max: 10n ** 24n });

describe("setsMinted", () => {
  it("reads a mint off DOWN and UP arriving beyond what the swaps moved, whatever was swapped", () => {
    fc.assert(
      fc.property(wei, signedWei, signedWei, (sets, down, up) => {
        const traded = option({ downSwapTokens: down, upSwapTokens: up, downDelta: sets + down, upDelta: sets + up });
        expect(setsMinted(traded)).toBe(sets);
      }),
    );
  });

  it("reads a merge as negative sets, whatever was swapped", () => {
    fc.assert(
      fc.property(wei, signedWei, signedWei, (sets, down, up) => {
        const traded = option({ downSwapTokens: down, upSwapTokens: up, downDelta: down - sets, upDelta: up - sets });
        expect(setsMinted(traded)).toBe(-sets);
      }),
    );
  });

  it("finds no sets when only swaps moved the tokens", () => {
    fc.assert(
      fc.property(signedWei, signedWei, (down, up) => {
        expect(setsMinted(option({ downSwapTokens: down, upSwapTokens: up, downDelta: down, upDelta: up }))).toBe(0n);
      }),
    );
  });

  it("counts only the sets both sides account for when one side moved further", () => {
    expect(setsMinted(option({ downDelta: parseEther("5"), upDelta: parseEther("3") }))).toBe(parseEther("3"));
    expect(setsMinted(option({ downDelta: -parseEther("2"), upDelta: -parseEther("7") }))).toBe(-parseEther("2"));
  });

  it("finds no sets when one side arrived and the other left beyond the swaps", () => {
    expect(setsMinted(option({ downDelta: parseEther("2"), upDelta: -parseEther("3") }))).toBe(0n);
  });
});

describe("sideSwaps", () => {
  it("lists UP then DOWN, a buy where tokens arrived, amounts unsigned", () => {
    const traded = option({
      downSwapTokens: -parseEther("8"),
      downSwapUnderlying: parseEther("3.2"),
      downAvgPrice: parseEther("0.4"),
      upSwapTokens: parseEther("6.5"),
      upSwapUnderlying: -parseEther("1.95"),
      upAvgPrice: parseEther("0.3"),
    });

    expect(sideSwaps(traded)).toEqual([
      {
        side: "UP",
        bought: true,
        tokens: parseEther("6.5"),
        underlying: parseEther("1.95"),
        avgPrice: parseEther("0.3"),
      },
      {
        side: "DOWN",
        bought: false,
        tokens: parseEther("8"),
        underlying: parseEther("3.2"),
        avgPrice: parseEther("0.4"),
      },
    ]);
  });

  it("leaves out a side that did not swap", () => {
    expect(sideSwaps(option({ upSwapTokens: parseEther("1") })).map((swap) => swap.side)).toEqual(["UP"]);
    expect(sideSwaps(option())).toEqual([]);
  });
});

describe("estimateAt", () => {
  it("reads the estimate off UP's price on the option's scale, before and after", () => {
    const traded = option({ upPriceBefore: parseEther("0.25"), upPriceAfter: parseEther("0.5") });

    expect(estimateAt(traded, SCALE, "before")).toBeCloseTo(200);
    expect(estimateAt(traded, SCALE, "after")).toBeCloseTo(300);
  });

  it("gives the same estimate from DOWN at the mirror price as from UP", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 18n }), (price) => {
        const fromUp = estimateAt(option({ upPriceAfter: price }), SCALE, "after")!;
        const fromDown = estimateAt(option({ downPriceAfter: 10n ** 18n - price }), SCALE, "after")!;
        expect(fromDown).toBeCloseTo(fromUp, 6);
      }),
    );
  });

  it("prefers UP when both sides swapped, and has none when neither did", () => {
    const both = option({ upPriceBefore: parseEther("0.25"), downPriceBefore: parseEther("0.5") });

    expect(estimateAt(both, SCALE, "before")).toBeCloseTo(200);
    expect(estimateAt(option(), SCALE, "before")).toBeNull();
  });
});

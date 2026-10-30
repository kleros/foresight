import { parseEther, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { addresses } from "@/testing/fixtures";

import type { TradeOption } from "../../types";
import { optionPnl } from "../positionPnl";

/**
 * A set mints DOWN, UP and the child's INVALID together, and a merge burns all three, so the INVALID the
 * wallet holds is the sets its predictions minted less merged. UP and DOWN that arrive or leave by plain
 * transfer move no INVALID, though the indexer's row for them reads like a mint or a merge.
 */

const MARKET = addresses.childMarkets[0]!.toLowerCase() as Address;
const e = (amount: string) => parseEther(amount);
const spot = { up: e("0.3"), down: e("0.7") };

type Move = Partial<
  Pick<
    TradeOption,
    "upDelta" | "downDelta" | "upSwapTokens" | "upSwapUnderlying" | "downSwapTokens" | "downSwapUnderlying"
  >
>;

/** The wallet's rows in one option, in order, each row's balances carried on from the one before. */
function history(moves: Move[]): TradeOption[] {
  let up = 0n;
  let down = 0n;
  return moves.map((move) => {
    up += move.upDelta ?? 0n;
    down += move.downDelta ?? 0n;
    return {
      childMarket: MARKET,
      upDelta: move.upDelta ?? 0n,
      downDelta: move.downDelta ?? 0n,
      upBalance: up,
      downBalance: down,
      upSwapTokens: move.upSwapTokens ?? 0n,
      upSwapUnderlying: move.upSwapUnderlying ?? 0n,
      downSwapTokens: move.downSwapTokens ?? 0n,
      downSwapUnderlying: move.downSwapUnderlying ?? 0n,
      upAvgPrice: null,
      downAvgPrice: null,
      upPriceBefore: null,
      upPriceAfter: null,
      downPriceBefore: null,
      downPriceAfter: null,
    };
  });
}

/** Mint 10 sets and sell the 10 DOWN for 6.5: cost 3.5, 10 UP and 10 INVALID kept. */
const mintAndSellDown: Move = {
  upDelta: e("10"),
  downDelta: 0n,
  downSwapTokens: -e("10"),
  downSwapUnderlying: e("6.5"),
};

/** UP and DOWN moved by plain transfer, `amount` of each, in the row the indexer writes for it. */
const pairedTransfer = (amount: bigint): Move => ({ upDelta: amount, downDelta: amount });

describe("INVALID held against the sets the predictions minted", () => {
  it("stays available when the INVALID held is the sets minted", () => {
    // cost 3.5; 10 UP at 0.3 is worth 3; P&L -0.5
    const result = optionPnl({
      predictions: history([mintAndSellDown]),
      held: { up: e("10"), down: 0n, invalid: e("10") },
      spot,
    });

    expect(result).toMatchObject({ available: true, cost: e("3.5"), value: e("3"), pnl: -e("0.5") });
  });

  it("stays available after a merge burns INVALID with the UP and DOWN", () => {
    // mint 10 and keep both sides, then merge 4: cost 10 - 4 = 6; 6 UP x 0.3 + 6 DOWN x 0.7 = 6; P&L 0
    const result = optionPnl({
      predictions: history([
        { upDelta: e("10"), downDelta: e("10") },
        { upDelta: -e("4"), downDelta: -e("4") },
      ]),
      held: { up: e("6"), down: e("6"), invalid: e("6") },
      spot,
    });

    expect(result).toMatchObject({ available: true, cost: e("6"), value: e("6"), pnl: 0n });
  });

  it("is unavailable when UP and DOWN arrive by plain transfer, with no INVALID", () => {
    // the transfer's row reads as a mint of 2, which would charge 2 the wallet never paid
    const result = optionPnl({
      predictions: history([pairedTransfer(e("2"))]),
      held: { up: e("2"), down: e("2"), invalid: 0n },
      spot,
    });

    expect(result).toMatchObject({ available: false });
  });

  it("is unavailable when UP and DOWN arrive by plain transfer after a mint", () => {
    // the rows net 12 UP and 2 DOWN, as held; the INVALID held is the mint's 10
    const result = optionPnl({
      predictions: history([mintAndSellDown, pairedTransfer(e("2"))]),
      held: { up: e("12"), down: e("2"), invalid: e("10") },
      spot,
    });

    expect(result).toMatchObject({ available: false });
  });

  it("is unavailable when UP and DOWN leave by plain transfer, the row reading as a merge", () => {
    // mint 10 and keep both sides, then send 3 UP and 3 DOWN away: the INVALID held is still 10
    const result = optionPnl({
      predictions: history([{ upDelta: e("10"), downDelta: e("10") }, pairedTransfer(-e("3"))]),
      held: { up: e("7"), down: e("7"), invalid: e("10") },
      spot,
    });

    expect(result).toMatchObject({ available: false });
  });

  it("is unavailable when INVALID alone arrives by plain transfer", () => {
    const result = optionPnl({
      predictions: history([mintAndSellDown]),
      held: { up: e("10"), down: 0n, invalid: e("12") },
      spot,
    });

    expect(result).toMatchObject({ available: false });
  });

  it("is unavailable when a mint's UP leaves by plain transfer in the same transaction", () => {
    // mint 10, send 4 UP away: the row nets 6 UP and 10 DOWN, read as a mint of 6
    const result = optionPnl({
      predictions: history([{ upDelta: e("6"), downDelta: e("10") }]),
      held: { up: e("6"), down: e("10"), invalid: e("10") },
      spot,
    });

    expect(result).toMatchObject({ available: false });
  });
});

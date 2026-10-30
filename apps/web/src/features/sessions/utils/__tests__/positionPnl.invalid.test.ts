import { parseEther, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { addresses } from "@/testing/fixtures";

import type { TradeOption, TradeOptionDetail } from "../../types";
import { optionPnl } from "../positionPnl";

/**
 * A set mints DOWN, UP and the child's INVALID together through Seer's router, and a merge burns all three, so
 * the INVALID the wallet holds is the sets its predictions minted less merged. UP and DOWN that arrive or leave
 * by plain transfer, with or without INVALID, have no router transfer, though the row reads like a mint or merge.
 */

const MARKET = addresses.childMarkets[0]!.toLowerCase() as Address;
const e = (amount: string) => parseEther(amount);
const spot = { up: e("0.3"), down: e("0.7") };

type Move = Partial<
  Pick<
    TradeOption,
    "upDelta" | "downDelta" | "upSwapTokens" | "upSwapUnderlying" | "downSwapTokens" | "downSwapUnderlying"
  >
> & {
  /** Sets Seer's router minted in the transaction, negative where it merged them. */
  sets?: bigint;
};

/** The wallet's rows in one option, in order, each row's balances carried on from the one before. */
function history(moves: Move[]): TradeOptionDetail[] {
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
      operations: move.sets
        ? [{ kind: move.sets > 0n ? "mint" : "merge", logIndex: 0, sets: move.sets > 0n ? move.sets : -move.sets }]
        : [],
    };
  });
}

/** Mint 10 sets and sell the 10 DOWN for 6.5: cost 3.5, 10 UP and 10 INVALID kept. */
const mintAndSellDown: Move = {
  sets: e("10"),
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
        { sets: e("10"), upDelta: e("10"), downDelta: e("10") },
        { sets: -e("4"), upDelta: -e("4"), downDelta: -e("4") },
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
      predictions: history([{ sets: e("10"), upDelta: e("10"), downDelta: e("10") }, pairedTransfer(-e("3"))]),
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

  it("is unavailable when INVALID alone leaves by plain transfer", () => {
    // the mint's 10 INVALID, 3 sent away; INVALID is not an indexed token, so no row records it
    const result = optionPnl({
      predictions: history([mintAndSellDown]),
      held: { up: e("10"), down: 0n, invalid: e("7") },
      spot,
    });

    expect(result).toMatchObject({ available: false });
  });

  it("is unavailable when UP and DOWN arrive by plain transfer in the transaction that mints", () => {
    // mint 10 and receive 2 of each: the row nets 12 UP and 12 DOWN, read as a mint of 12; 10 INVALID held
    const result = optionPnl({
      predictions: history([{ sets: e("10"), upDelta: e("12"), downDelta: e("12") }]),
      held: { up: e("12"), down: e("12"), invalid: e("10") },
      spot,
    });

    expect(result).toMatchObject({ available: false });
  });

  it("is unavailable when UP and DOWN leave by plain transfer in the transaction that merges", () => {
    // mint 10, then merge 4 and send 2 of each away: that row nets -6 of each, read as a merge of 6; 6 INVALID held
    const result = optionPnl({
      predictions: history([
        { sets: e("10"), upDelta: e("10"), downDelta: e("10") },
        { sets: -e("4"), upDelta: -e("6"), downDelta: -e("6") },
      ]),
      held: { up: e("4"), down: e("4"), invalid: e("6") },
      spot,
    });

    expect(result).toMatchObject({ available: false });
  });

  it("is unavailable when a mint's UP and DOWN all leave by plain transfer in the same transaction", () => {
    // mint 10 and send the 10 UP and 10 DOWN away: the row nets nothing; the 10 INVALID stays
    const result = optionPnl({
      predictions: history([{ sets: e("10"), upDelta: 0n, downDelta: 0n }]),
      held: { up: 0n, down: 0n, invalid: e("10") },
      spot,
    });

    expect(result).toMatchObject({ available: false });
  });

  it("is unavailable when UP and DOWN arrive by plain transfer in the transaction that mints and sells DOWN", () => {
    // mint 10, sell the 10 DOWN for 6.5 and receive 2 of each: the row nets 12 UP and 2 DOWN; 10 INVALID held
    const result = optionPnl({
      predictions: history([{ ...mintAndSellDown, upDelta: e("12"), downDelta: e("2") }]),
      held: { up: e("12"), down: e("2"), invalid: e("10") },
      spot,
    });

    expect(result).toMatchObject({ available: false });
  });

  it("is unavailable when a mint's UP leaves by plain transfer in the same transaction", () => {
    // mint 10, send 4 UP away: the row nets 6 UP and 10 DOWN, read as a mint of 6
    const result = optionPnl({
      predictions: history([{ sets: e("10"), upDelta: e("6"), downDelta: e("10") }]),
      held: { up: e("6"), down: e("10"), invalid: e("10") },
      spot,
    });

    expect(result).toMatchObject({ available: false });
  });
});

describe("sets the router did not move", () => {
  /** UP, DOWN and INVALID of one amount by plain transfer: the row reads as a mint or merge, INVALID writes none. */
  const wholeSetTransfer = (amount: bigint): Move => ({ upDelta: amount, downDelta: amount });

  it("values 5 sets the router minted and the wallet kept whole", () => {
    // cost 5; 5 UP x 0.3 + 5 DOWN x 0.7 = 5; P&L 0
    const result = optionPnl({
      predictions: history([{ sets: e("5"), upDelta: e("5"), downDelta: e("5") }]),
      held: { up: e("5"), down: e("5"), invalid: e("5") },
      spot,
    });

    expect(result).toMatchObject({ available: true, cost: e("5"), value: e("5"), pnl: 0n });
  });

  it("is unavailable when a whole set of UP, DOWN and INVALID arrives by plain transfer", () => {
    // the same holdings as 5 sets minted, but no router transfer behind the row: the wallet paid nothing
    const result = optionPnl({
      predictions: history([wholeSetTransfer(e("5"))]),
      held: { up: e("5"), down: e("5"), invalid: e("5") },
      spot,
    });

    expect(result).toMatchObject({ available: false });
  });

  it("is unavailable when a whole set arrives by plain transfer after a mint", () => {
    // the mint keeps 10 UP and 10 INVALID; 5 of each side and 5 INVALID arrive: 15 UP, 5 DOWN, 15 INVALID
    const result = optionPnl({
      predictions: history([mintAndSellDown, wholeSetTransfer(e("5"))]),
      held: { up: e("15"), down: e("5"), invalid: e("15") },
      spot,
    });

    expect(result).toMatchObject({ available: false });
  });

  it("is unavailable when a whole set leaves by plain transfer", () => {
    // mint 10 and keep both sides, then send 3 UP, 3 DOWN and 3 INVALID away: the row reads as a merge of 3
    const result = optionPnl({
      predictions: history([{ sets: e("10"), upDelta: e("10"), downDelta: e("10") }, wholeSetTransfer(-e("3"))]),
      held: { up: e("7"), down: e("7"), invalid: e("7") },
      spot,
    });

    expect(result).toMatchObject({ available: false });
  });
});

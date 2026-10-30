import fc from "fast-check";
import { parseEther, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { addresses } from "@/testing/fixtures";

import type { TradeOption } from "../../types";
import { optionPnl, sessionPnl } from "../positionPnl";

/**
 * Acceptance tests A3 to A6 of issue 2026-10-30-foresight-my-trades-pnl: one option's expected P&L
 * from the trade wallet's predictions in it, what it holds now and the pools' spot prices.
 *
 * The interface these tests hold the module to, all amounts in underlying or outcome-token wei:
 * - `optionPnl({ predictions, held: { up, down }, spot: { up, down } })`, where `predictions` are the
 *   wallet's `TradeOption` slices in that option and `spot` is each pool's `underlyingPerOutcome`
 *   (1e18-scaled, null until the pool prices), returns `{ available: true, cost, value, pnl }` or
 *   `{ available: false }`; `cost` is the underlying put into the option: sets minted plus what buys
 *   paid, less what sells returned;
 * - `sessionPnl(options)` sums the available ones into `{ pnl, excluded }`, `excluded` counting the rest.
 */

const MARKET = addresses.childMarkets[0]!.toLowerCase() as Address;
const e = (amount: string) => parseEther(amount);
const ONE = 10n ** 18n;

type Move = {
  upDelta?: bigint;
  downDelta?: bigint;
  upSwapTokens?: bigint;
  upSwapUnderlying?: bigint;
  downSwapTokens?: bigint;
  downSwapUnderlying?: bigint;
};

const avg = (tokens: bigint, underlying: bigint) =>
  tokens === 0n ? null : ((underlying < 0n ? -underlying : underlying) * ONE) / (tokens < 0n ? -tokens : tokens);

/** The wallet's predictions in one option, in order, each row's balances carried on from the one before. */
function history(moves: Move[]): TradeOption[] {
  let up = 0n;
  let down = 0n;
  return moves.map((move) => {
    up += move.upDelta ?? 0n;
    down += move.downDelta ?? 0n;
    const upSwapTokens = move.upSwapTokens ?? 0n;
    const downSwapTokens = move.downSwapTokens ?? 0n;
    return {
      childMarket: MARKET,
      upDelta: move.upDelta ?? 0n,
      downDelta: move.downDelta ?? 0n,
      upBalance: up,
      downBalance: down,
      upSwapTokens,
      upSwapUnderlying: move.upSwapUnderlying ?? 0n,
      downSwapTokens,
      downSwapUnderlying: move.downSwapUnderlying ?? 0n,
      upAvgPrice: avg(upSwapTokens, move.upSwapUnderlying ?? 0n),
      downAvgPrice: avg(downSwapTokens, move.downSwapUnderlying ?? 0n),
      upPriceBefore: null,
      upPriceAfter: null,
      downPriceBefore: null,
      downPriceAfter: null,
    };
  });
}

/** Deposit 10 underlying, mint 10 UP and 10 DOWN, sell the 10 DOWN for 6.5: 3.5 spent, 10 UP kept. */
const mintAndSellDown: Move = {
  upDelta: e("10"),
  downDelta: 0n,
  downSwapTokens: -e("10"),
  downSwapUnderlying: e("6.5"),
};

/** Sell 4 of those UP for 1.4. */
const sellFourUp: Move = {
  upDelta: -e("4"),
  upSwapTokens: -e("4"),
  upSwapUnderlying: e("1.4"),
};

describe("expected P&L per option (A3)", () => {
  it("marks a mint-and-sell-DOWN then a partial UP sell at the UP spot, less what was paid net", () => {
    // cost 3.5 - 1.4 = 2.1; 6 UP held at 0.3 is worth 1.8; P&L -0.3
    const result = optionPnl({
      predictions: history([mintAndSellDown, sellFourUp]),
      held: { up: e("6"), down: 0n },
      spot: { up: e("0.3"), down: e("0.7") },
    });

    expect(result).toMatchObject({ available: true, cost: e("2.1"), value: e("1.8"), pnl: -e("0.3") });
  });

  it("values both sides when the wallet keeps DOWN from an outright buy and a mint-and-sell-UP", () => {
    // buy 5 DOWN for 2.5; mint 4 and sell the 4 UP for 1: cost 2.5 + 3 = 5.5
    // 9 DOWN at 0.7 is 6.3; P&L +0.8
    const result = optionPnl({
      predictions: history([
        { downDelta: e("5"), downSwapTokens: e("5"), downSwapUnderlying: -e("2.5") },
        { downDelta: e("4"), upSwapTokens: -e("4"), upSwapUnderlying: e("1") },
      ]),
      held: { up: 0n, down: e("9") },
      spot: { up: e("0.3"), down: e("0.7") },
    });

    expect(result).toMatchObject({ available: true, cost: e("5.5"), value: e("6.3"), pnl: e("0.8") });
  });

  it("adds UP and DOWN held, each at its own spot, when the wallet keeps both", () => {
    // two outright buys: 10 UP for 2.8 and 2 DOWN for 1.5; cost 4.3
    // 10 x 0.25 + 2 x 0.8 = 4.1; P&L -0.2
    const result = optionPnl({
      predictions: history([
        { upDelta: e("10"), upSwapTokens: e("10"), upSwapUnderlying: -e("2.8") },
        { downDelta: e("2"), downSwapTokens: e("2"), downSwapUnderlying: -e("1.5") },
      ]),
      held: { up: e("10"), down: e("2") },
      spot: { up: e("0.25"), down: e("0.8") },
    });

    expect(result).toMatchObject({ available: true, cost: e("4.3"), value: e("4.1"), pnl: -e("0.2") });
  });

  it("is UP x spotUP + DOWN x spotDOWN - (sets minted + paid - returned) over any accounted-for holdings", () => {
    // amounts and prices on a 1e9-wei grid, so every product divides by 1e18 exactly
    const grid = (max: bigint) => fc.bigInt({ min: 0n, max }).map((units) => units * 10n ** 9n);
    /** Mint `sets`, then on each side buy (tokens > 0, paying) or sell (tokens < 0, returned) for `underlying`. */
    const trade = fc.record({
      sets: grid(10n ** 12n),
      upTokens: grid(10n ** 12n),
      upUnderlying: grid(10n ** 12n),
      upSold: fc.boolean(),
      downTokens: grid(10n ** 12n),
      downUnderlying: grid(10n ** 12n),
      downSold: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc.array(trade, { minLength: 1, maxLength: 6 }),
        grid(10n ** 9n),
        grid(10n ** 9n),
        (trades, up, down) => {
          const moves: Move[] = trades.map((each) => {
            const upTokens = each.upSold ? -each.upTokens : each.upTokens;
            const downTokens = each.downSold ? -each.downTokens : each.downTokens;
            return {
              upDelta: each.sets + upTokens,
              downDelta: each.sets + downTokens,
              upSwapTokens: upTokens,
              upSwapUnderlying: each.upSold ? each.upUnderlying : -each.upUnderlying,
              downSwapTokens: downTokens,
              downSwapUnderlying: each.downSold ? each.downUnderlying : -each.downUnderlying,
            };
          });
          const predictions = history(moves);
          const heldUp = moves.reduce((sum, each) => sum + each.upDelta!, 0n);
          const heldDown = moves.reduce((sum, each) => sum + each.downDelta!, 0n);
          const paid = (sold: boolean, underlying: bigint) => (sold ? -underlying : underlying);
          const cost = trades.reduce(
            (sum, each) =>
              sum + each.sets + paid(each.upSold, each.upUnderlying) + paid(each.downSold, each.downUnderlying),
            0n,
          );
          const value = (heldUp * up + heldDown * down) / ONE;

          const result = optionPnl({ predictions, held: { up: heldUp, down: heldDown }, spot: { up, down } });

          expect(result).toMatchObject({ available: true, cost, value, pnl: value - cost });
        },
      ),
      { seed: 20_261_030 },
    );
  });
});

describe("expected P&L after a prediction that split sDAI in the same transaction (A3)", () => {
  it("charges a split-then-buy for what the buy spent, not for the split's credit", () => {
    // 50 sDAI split at the parent credits 50 underlying; buying 10 UP spends 4 of it
    // cost 4; 10 UP at 0.3 is worth 3; P&L -1
    const result = optionPnl({
      predictions: history([{ upDelta: e("10"), upSwapTokens: e("10"), upSwapUnderlying: -e("4") }]),
      held: { up: e("10"), down: 0n },
      spot: { up: e("0.3"), down: e("0.7") },
    });

    expect(result).toMatchObject({ available: true, cost: e("4"), value: e("3"), pnl: -e("1") });
  });

  it("charges a mint that sold DOWN and bought UP for the sets, plus the buy, less the sale", () => {
    // the parent split credits 10 underlying; split it into 10 UP and 10 DOWN
    // sell the 10 DOWN for 6, buy 5 UP for 2.5: cost 10 + 2.5 - 6 = 6.5
    // 15 UP at 0.5 is worth 7.5; P&L +1
    const result = optionPnl({
      predictions: history([
        {
          upDelta: e("15"),
          downDelta: 0n,
          downSwapTokens: -e("10"),
          downSwapUnderlying: e("6"),
          upSwapTokens: e("5"),
          upSwapUnderlying: -e("2.5"),
        },
      ]),
      held: { up: e("15"), down: 0n },
      spot: { up: e("0.5"), down: e("0.5") },
    });

    expect(result).toMatchObject({ available: true, cost: e("6.5"), value: e("7.5"), pnl: e("1") });
  });
});

describe("a full exit (A4)", () => {
  it("leaves the P&L at the underlying gained after buying UP and selling all of it", () => {
    // buy 8 UP for 3.2, sell the 8 for 4: started 3.2 down, ended 0.8 up
    const result = optionPnl({
      predictions: history([
        { upDelta: e("8"), upSwapTokens: e("8"), upSwapUnderlying: -e("3.2") },
        { upDelta: -e("8"), upSwapTokens: -e("8"), upSwapUnderlying: e("4") },
      ]),
      held: { up: 0n, down: 0n },
      spot: { up: e("0.5"), down: e("0.5") },
    });

    expect(result).toMatchObject({ available: true, value: 0n, pnl: e("0.8") });
  });

  it("leaves the P&L at the underlying lost after a mint-and-sell-DOWN whose UP is all sold", () => {
    // 3.5 spent, the 10 UP sold for 2.9: 0.6 lost
    const result = optionPnl({
      predictions: history([
        mintAndSellDown,
        { upDelta: -e("10"), upSwapTokens: -e("10"), upSwapUnderlying: e("2.9") },
      ]),
      held: { up: 0n, down: 0n },
      spot: { up: e("0.2"), down: e("0.8") },
    });

    expect(result).toMatchObject({ available: true, value: 0n, pnl: -e("0.6") });
  });

  it("equals final underlying minus initial for any trades that end holding nothing, whatever the spot", () => {
    const amount = fc.bigInt({ min: 0n, max: 10n ** 24n });
    /** Mint `sets`, buy `up` UP for `upPaid` and `down` DOWN for `downPaid`. */
    const trade = fc.record({ sets: amount, up: amount, upPaid: amount, down: amount, downPaid: amount });
    fc.assert(
      fc.property(
        fc.array(trade, { minLength: 1, maxLength: 6 }),
        amount,
        amount,
        fc.bigInt({ min: 1n, max: ONE }),
        fc.bigInt({ min: 1n, max: ONE }),
        (trades, upReturned, downReturned, up, down) => {
          const heldUp = trades.reduce((sum, each) => sum + each.sets + each.up, 0n);
          const heldDown = trades.reduce((sum, each) => sum + each.sets + each.down, 0n);
          const moves: Move[] = [
            ...trades.map((each) => ({
              upDelta: each.sets + each.up,
              downDelta: each.sets + each.down,
              upSwapTokens: each.up,
              upSwapUnderlying: -each.upPaid,
              downSwapTokens: each.down,
              downSwapUnderlying: -each.downPaid,
            })),
            // the exit sells everything held on both sides
            {
              upDelta: -heldUp,
              downDelta: -heldDown,
              upSwapTokens: -heldUp,
              upSwapUnderlying: upReturned,
              downSwapTokens: -heldDown,
              downSwapUnderlying: downReturned,
            },
          ];
          const underlyingGained =
            upReturned + downReturned - trades.reduce((sum, each) => sum + each.sets + each.upPaid + each.downPaid, 0n);

          const result = optionPnl({ predictions: history(moves), held: { up: 0n, down: 0n }, spot: { up, down } });

          expect(result).toMatchObject({ available: true, value: 0n, pnl: underlyingGained });
        },
      ),
      { seed: 20_261_030 },
    );
  });
});

describe("tokens no prediction accounts for (A5)", () => {
  const spot = { up: e("0.3"), down: e("0.7") };

  it("is unavailable when the wallet holds more UP than its predictions net", () => {
    // the predictions net 6 UP; 2 more arrived by plain transfer
    const result = optionPnl({
      predictions: history([mintAndSellDown, sellFourUp]),
      held: { up: e("8"), down: 0n },
      spot,
    });

    expect(result).toMatchObject({ available: false });
  });

  it("is unavailable when the wallet holds DOWN its predictions never bought", () => {
    const result = optionPnl({
      predictions: history([mintAndSellDown, sellFourUp]),
      held: { up: e("6"), down: e("1") },
      spot,
    });

    expect(result).toMatchObject({ available: false });
  });

  it("is unavailable when the wallet holds tokens of an option it never predicted on", () => {
    const result = optionPnl({ predictions: [], held: { up: e("3"), down: 0n }, spot });

    expect(result).toMatchObject({ available: false });
  });

  it("stays available when the holdings are exactly what the predictions net", () => {
    const result = optionPnl({
      predictions: history([mintAndSellDown, sellFourUp]),
      held: { up: e("6"), down: 0n },
      spot,
    });

    expect(result).toMatchObject({ available: true });
  });

  it("is unavailable for any surplus over the predictions' net tokens, on either side", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 24n }), fc.boolean(), (surplus, onUp) => {
        const held = { up: e("6") + (onUp ? surplus : 0n), down: onUp ? 0n : surplus };

        expect(optionPnl({ predictions: history([mintAndSellDown, sellFourUp]), held, spot })).toMatchObject({
          available: false,
        });
      }),
      { seed: 20_261_030 },
    );
  });

  it("leaves an unavailable option out of the session total and counts it as excluded", () => {
    // option one: -0.3 as in A3; option two holds transferred-in tokens
    const priced = optionPnl({
      predictions: history([mintAndSellDown, sellFourUp]),
      held: { up: e("6"), down: 0n },
      spot,
    });
    const transferred = optionPnl({ predictions: history([mintAndSellDown]), held: { up: e("12"), down: 0n }, spot });
    // option three: bought 10 UP for 2.6, worth 3
    const other = optionPnl({
      predictions: history([{ upDelta: e("10"), upSwapTokens: e("10"), upSwapUnderlying: -e("2.6") }]),
      held: { up: e("10"), down: 0n },
      spot,
    });

    expect(sessionPnl([priced, transferred, other])).toMatchObject({ pnl: e("0.1"), excluded: 1 });
    expect(sessionPnl([priced, other])).toMatchObject({ pnl: e("0.1"), excluded: 0 });
  });
});

describe("a pool not priced yet (A6)", () => {
  it("is unavailable rather than valuing held UP at 0 when the UP pool has no price", () => {
    const result = optionPnl({
      predictions: history([mintAndSellDown, sellFourUp]),
      held: { up: e("6"), down: 0n },
      spot: { up: null, down: e("0.7") },
    });

    expect(result).toMatchObject({ available: false });
  });

  it("is unavailable when the DOWN pool has no price and DOWN is held", () => {
    const result = optionPnl({
      predictions: history([{ downDelta: e("5"), downSwapTokens: e("5"), downSwapUnderlying: -e("2.5") }]),
      held: { up: 0n, down: e("5") },
      spot: { up: e("0.3"), down: null },
    });

    expect(result).toMatchObject({ available: false });
  });

  it("is unavailable when neither pool has priced", () => {
    const result = optionPnl({
      predictions: history([mintAndSellDown, sellFourUp]),
      held: { up: e("6"), down: 0n },
      spot: { up: null, down: null },
    });

    expect(result).toMatchObject({ available: false });
  });

  it("leaves an unpriced option out of the session total and counts it as excluded", () => {
    const unpriced = optionPnl({
      predictions: history([mintAndSellDown, sellFourUp]),
      held: { up: e("6"), down: 0n },
      spot: { up: null, down: null },
    });
    const priced = optionPnl({
      predictions: history([{ upDelta: e("10"), upSwapTokens: e("10"), upSwapUnderlying: -e("2.6") }]),
      held: { up: e("10"), down: 0n },
      spot: { up: e("0.3"), down: e("0.7") },
    });

    expect(sessionPnl([unpriced, priced])).toMatchObject({ pnl: e("0.4"), excluded: 1 });
  });
});

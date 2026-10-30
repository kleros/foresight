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
 *   `{ available: false }`;
 * - `sessionPnl(options)` sums the available ones into `{ pnl, excluded }`, `excluded` counting the rest.
 */

const MARKET = addresses.childMarkets[0]!.toLowerCase() as Address;
const e = (amount: string) => parseEther(amount);
const ONE = 10n ** 18n;

type Move = {
  underlyingDelta: bigint;
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
      underlyingDelta: move.underlyingDelta,
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
  underlyingDelta: -e("3.5"),
  upDelta: e("10"),
  downDelta: 0n,
  downSwapTokens: -e("10"),
  downSwapUnderlying: e("6.5"),
};

/** Sell 4 of those UP for 1.4. */
const sellFourUp: Move = {
  underlyingDelta: e("1.4"),
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
        { underlyingDelta: -e("2.5"), downDelta: e("5"), downSwapTokens: e("5"), downSwapUnderlying: -e("2.5") },
        { underlyingDelta: -e("3"), downDelta: e("4"), upSwapTokens: -e("4"), upSwapUnderlying: e("1") },
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
        { underlyingDelta: -e("2.8"), upDelta: e("10"), upSwapTokens: e("10"), upSwapUnderlying: -e("2.8") },
        { underlyingDelta: -e("1.5"), downDelta: e("2"), downSwapTokens: e("2"), downSwapUnderlying: -e("1.5") },
      ]),
      held: { up: e("10"), down: e("2") },
      spot: { up: e("0.25"), down: e("0.8") },
    });

    expect(result).toMatchObject({ available: true, cost: e("4.3"), value: e("4.1"), pnl: -e("0.2") });
  });

  it("is UP x spotUP + DOWN x spotDOWN - sum(-underlyingDelta) over any accounted-for holdings", () => {
    // amounts and prices on a 1e9-wei grid, so every product divides by 1e18 exactly
    const grid = (max: bigint) => fc.bigInt({ min: 0n, max }).map((units) => units * 10n ** 9n);
    const move = fc.record({
      underlyingDelta: fc.bigInt({ min: -(10n ** 24n), max: 10n ** 24n }),
      upDelta: grid(10n ** 12n),
      downDelta: grid(10n ** 12n),
    });
    fc.assert(
      fc.property(
        fc.array(move, { minLength: 1, maxLength: 6 }),
        grid(10n ** 9n),
        grid(10n ** 9n),
        (moves, up, down) => {
          const predictions = history(moves);
          const heldUp = moves.reduce((sum, each) => sum + each.upDelta, 0n);
          const heldDown = moves.reduce((sum, each) => sum + each.downDelta, 0n);
          const cost = moves.reduce((sum, each) => sum - each.underlyingDelta, 0n);
          const value = (heldUp * up + heldDown * down) / ONE;

          const result = optionPnl({ predictions, held: { up: heldUp, down: heldDown }, spot: { up, down } });

          expect(result).toMatchObject({ available: true, cost, value, pnl: value - cost });
        },
      ),
      { seed: 20_261_030 },
    );
  });
});

describe("a full exit (A4)", () => {
  it("leaves the P&L at the underlying gained after buying UP and selling all of it", () => {
    // buy 8 UP for 3.2, sell the 8 for 4: started 3.2 down, ended 0.8 up
    const result = optionPnl({
      predictions: history([
        { underlyingDelta: -e("3.2"), upDelta: e("8"), upSwapTokens: e("8"), upSwapUnderlying: -e("3.2") },
        { underlyingDelta: e("4"), upDelta: -e("8"), upSwapTokens: -e("8"), upSwapUnderlying: e("4") },
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
        { underlyingDelta: e("2.9"), upDelta: -e("10"), upSwapTokens: -e("10"), upSwapUnderlying: e("2.9") },
      ]),
      held: { up: 0n, down: 0n },
      spot: { up: e("0.2"), down: e("0.8") },
    });

    expect(result).toMatchObject({ available: true, value: 0n, pnl: -e("0.6") });
  });

  it("equals final underlying minus initial for any trades that end holding nothing, whatever the spot", () => {
    const amount = fc.bigInt({ min: 0n, max: 10n ** 24n });
    const trade = fc.record({
      underlyingDelta: fc.bigInt({ min: -(10n ** 24n), max: 10n ** 24n }),
      up: amount,
      down: amount,
    });
    fc.assert(
      fc.property(
        fc.array(trade, { minLength: 1, maxLength: 6 }),
        fc.bigInt({ min: -(10n ** 24n), max: 10n ** 24n }),
        fc.bigInt({ min: 1n, max: ONE }),
        fc.bigInt({ min: 1n, max: ONE }),
        (trades, exitDelta, up, down) => {
          const heldUp = trades.reduce((sum, each) => sum + each.up, 0n);
          const heldDown = trades.reduce((sum, each) => sum + each.down, 0n);
          const moves: Move[] = [
            ...trades.map((each) => ({
              underlyingDelta: each.underlyingDelta,
              upDelta: each.up,
              downDelta: each.down,
            })),
            { underlyingDelta: exitDelta, upDelta: -heldUp, downDelta: -heldDown },
          ];
          const underlyingGained = moves.reduce((sum, each) => sum + each.underlyingDelta, 0n);

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
      predictions: history([
        { underlyingDelta: -e("2.6"), upDelta: e("10"), upSwapTokens: e("10"), upSwapUnderlying: -e("2.6") },
      ]),
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
      predictions: history([
        { underlyingDelta: -e("2.5"), downDelta: e("5"), downSwapTokens: e("5"), downSwapUnderlying: -e("2.5") },
      ]),
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
      predictions: history([
        { underlyingDelta: -e("2.6"), upDelta: e("10"), upSwapTokens: e("10"), upSwapUnderlying: -e("2.6") },
      ]),
      held: { up: e("10"), down: 0n },
      spot: { up: e("0.3"), down: e("0.7") },
    });

    expect(sessionPnl([unpriced, priced])).toMatchObject({ pnl: e("0.4"), excluded: 1 });
  });
});

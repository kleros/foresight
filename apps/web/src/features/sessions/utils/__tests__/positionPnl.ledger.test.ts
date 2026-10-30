import fc from "fast-check";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";

import { addresses } from "@/testing/fixtures";

import type { TradeOption } from "../../types";
import { optionPnl } from "../positionPnl";

/**
 * Expected P&L checked against a ledger of the wallet's underlying, UP, DOWN and INVALID through parent split
 * credits, mints, buys, sells and merges, each transaction netted into the row the indexer writes for it.
 * The expected cost is the underlying the ledger consumed: what parent splits credited less what it ends with.
 */

const MARKET = addresses.childMarkets[0]!.toLowerCase() as Address;
const ONE = 10n ** 18n;
const SEED = 20_261_030;
const min = (...values: bigint[]) => values.reduce((a, b) => (a < b ? a : b));

/** Amounts on a 1e9-wei grid, so a token amount times a spot price divides by 1e18 exactly. */
const grid = (max: bigint) => fc.bigInt({ min: 0n, max }).map((units) => units * 10n ** 9n);
const amount = grid(10n ** 12n);
const price = grid(10n ** 9n);

/** One transaction: a parent split credit, a mint, a buy or sell on each side, then a merge. */
const transaction = fc.record({
  credit: amount,
  mint: amount,
  upTokens: amount,
  upUnderlying: amount,
  upSold: fc.boolean(),
  downTokens: amount,
  downUnderlying: amount,
  downSold: fc.boolean(),
  merge: amount,
});
type Transaction = typeof transaction extends fc.Arbitrary<infer T> ? T : never;

interface Ledger {
  underlying: bigint;
  credited: bigint;
  up: bigint;
  down: bigint;
  invalid: bigint;
}

/** A sell is capped at what the side holds; a swap of no tokens moves no underlying. */
function swap(ledger: Ledger, side: "up" | "down", tokens: bigint, underlying: bigint, sold: boolean) {
  const moved = sold ? min(tokens, ledger[side]) : tokens;
  const paid = moved === 0n ? 0n : underlying;
  ledger[side] += sold ? -moved : moved;
  ledger.underlying += sold ? paid : -paid;
  return { tokens: sold ? -moved : moved, underlying: sold ? paid : -paid };
}

/** Runs the transactions through the ledger, returning the indexer's rows and what the wallet ends with. */
function simulate(transactions: Transaction[]): { rows: TradeOption[]; ledger: Ledger } {
  const ledger: Ledger = { underlying: 0n, credited: 0n, up: 0n, down: 0n, invalid: 0n };
  const rows = transactions.map((tx): TradeOption => {
    const before = { up: ledger.up, down: ledger.down };
    ledger.underlying += tx.credit;
    ledger.credited += tx.credit;
    ledger.underlying -= tx.mint;
    ledger.up += tx.mint;
    ledger.down += tx.mint;
    ledger.invalid += tx.mint;
    const up = swap(ledger, "up", tx.upTokens, tx.upUnderlying, tx.upSold);
    const down = swap(ledger, "down", tx.downTokens, tx.downUnderlying, tx.downSold);
    const merged = min(tx.merge, ledger.up, ledger.down, ledger.invalid);
    ledger.up -= merged;
    ledger.down -= merged;
    ledger.invalid -= merged;
    ledger.underlying += merged;
    return {
      childMarket: MARKET,
      upDelta: ledger.up - before.up,
      downDelta: ledger.down - before.down,
      upBalance: ledger.up,
      downBalance: ledger.down,
      upSwapTokens: up.tokens,
      upSwapUnderlying: up.underlying,
      downSwapTokens: down.tokens,
      downSwapUnderlying: down.underlying,
      upAvgPrice: null,
      downAvgPrice: null,
      upPriceBefore: null,
      upPriceAfter: null,
      downPriceBefore: null,
      downPriceAfter: null,
    };
  });
  return { rows, ledger };
}

/** A transaction that sells everything the wallet holds of both sides for `returned`. */
const exitAll = (ledger: Ledger, returned: { up: bigint; down: bigint }): Transaction => ({
  credit: 0n,
  mint: 0n,
  upTokens: ledger.up,
  upUnderlying: returned.up,
  upSold: true,
  downTokens: ledger.down,
  downUnderlying: returned.down,
  downSold: true,
  merge: 0n,
});

describe("expected P&L against a ledger of the wallet's underlying (A3, A4)", () => {
  it("is the held tokens at spot plus the underlying the ledger ends with, less what parent splits credited", () => {
    fc.assert(
      fc.property(fc.array(transaction, { minLength: 1, maxLength: 6 }), price, price, (transactions, up, down) => {
        const { rows, ledger } = simulate(transactions);
        const value = (ledger.up * up + ledger.down * down) / ONE;

        const result = optionPnl({
          predictions: rows,
          held: { up: ledger.up, down: ledger.down, invalid: ledger.invalid },
          spot: { up, down },
        });

        expect(result).toMatchObject({
          available: true,
          cost: ledger.credited - ledger.underlying,
          value,
          pnl: value + ledger.underlying - ledger.credited,
        });
      }),
      { seed: SEED },
    );
  });

  it("is the underlying gained or lost once everything held is sold, whatever the spot", () => {
    fc.assert(
      fc.property(
        fc.array(transaction, { minLength: 1, maxLength: 6 }),
        amount,
        amount,
        price,
        price,
        (transactions, upReturned, downReturned, up, down) => {
          const { ledger: held } = simulate(transactions);
          const { rows, ledger } = simulate([...transactions, exitAll(held, { up: upReturned, down: downReturned })]);

          const result = optionPnl({
            predictions: rows,
            held: { up: 0n, down: 0n, invalid: ledger.invalid },
            spot: { up, down },
          });

          expect(result).toMatchObject({ available: true, value: 0n, pnl: ledger.underlying - ledger.credited });
        },
      ),
      { seed: SEED },
    );
  });

  it("is unavailable once UP and DOWN move by plain transfer, in or out", () => {
    fc.assert(
      fc.property(
        fc.array(transaction, { minLength: 1, maxLength: 6 }),
        grid(10n ** 12n).filter((each) => each > 0n),
        fc.boolean(),
        price,
        price,
        (transactions, size, out, up, down) => {
          const { rows, ledger } = simulate(transactions);
          const moved = out ? -min(size, ledger.up, ledger.down) : size;
          fc.pre(moved !== 0n);
          const transferred: TradeOption = {
            ...rows.at(-1)!,
            upDelta: moved,
            downDelta: moved,
            upBalance: ledger.up + moved,
            downBalance: ledger.down + moved,
            upSwapTokens: 0n,
            upSwapUnderlying: 0n,
            downSwapTokens: 0n,
            downSwapUnderlying: 0n,
          };

          const result = optionPnl({
            predictions: [...rows, transferred],
            held: { up: ledger.up + moved, down: ledger.down + moved, invalid: ledger.invalid },
            spot: { up, down },
          });

          expect(result).toMatchObject({ available: false });
        },
      ),
      { seed: SEED },
    );
  });
});

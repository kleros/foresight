import type { TradeOption } from "../types";
import { optionCost } from "./tradeDetail";

const ONE = 10n ** 18n;

interface Sides<T> {
  up: T;
  down: T;
}

/** One option's expected P&L in underlying wei: what the held tokens are worth at spot, less what was put in. */
export type OptionPnl = { available: true; cost: bigint; value: bigint; pnl: bigint } | { available: false };

/**
 * Cost is the predictions' `optionCost`, summed; value marks the held tokens at the pools' spot prices
 * (`underlyingPerOutcome`, 1e18-scaled). Unavailable when the holdings differ from what the predictions net,
 * or a held side's pool has no price.
 */
export function optionPnl({
  predictions,
  held,
  spot,
}: {
  predictions: TradeOption[];
  held: Sides<bigint>;
  spot: Sides<bigint | null>;
}): OptionPnl {
  const netUp = predictions.reduce((sum, each) => sum + each.upDelta, 0n);
  const netDown = predictions.reduce((sum, each) => sum + each.downDelta, 0n);
  if (held.up !== netUp || held.down !== netDown) return { available: false };
  if ((held.up !== 0n && spot.up === null) || (held.down !== 0n && spot.down === null)) return { available: false };

  const cost = predictions.reduce((sum, each) => sum + optionCost(each), 0n);
  const value = (held.up * (spot.up ?? 0n) + held.down * (spot.down ?? 0n)) / ONE;
  return { available: true, cost, value, pnl: value - cost };
}

/** The available options' P&L summed, and how many were left out as unavailable. */
export function sessionPnl(options: OptionPnl[]): { cost: bigint; pnl: bigint; excluded: number } {
  let cost = 0n;
  let pnl = 0n;
  let excluded = 0;
  for (const option of options) {
    if (!option.available) {
      excluded += 1;
      continue;
    }
    cost += option.cost;
    pnl += option.pnl;
  }
  return { cost, pnl, excluded };
}

/** Underlying paid per token over the side's buys, weighted by tokens bought; null where it never bought. */
export function avgEntry(predictions: TradeOption[], side: "up" | "down"): bigint | null {
  let tokens = 0n;
  let weighted = 0n;
  for (const each of predictions) {
    const bought = side === "up" ? each.upSwapTokens : each.downSwapTokens;
    const price = side === "up" ? each.upAvgPrice : each.downAvgPrice;
    if (bought <= 0n || price === null) continue;
    tokens += bought;
    weighted += price * bought;
  }
  return tokens === 0n ? null : weighted / tokens;
}

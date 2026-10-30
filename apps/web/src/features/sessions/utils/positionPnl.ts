import type { TradeOption, TradeOptionDetail } from "../types";
import { optionCost, setsMinted } from "./tradeDetail";

const ONE = 10n ** 18n;

interface Sides<T> {
  up: T;
  down: T;
}

/** One option's expected P&L in underlying wei: what the held tokens are worth at spot, less what was put in. */
export type OptionPnl = { available: true; cost: bigint; value: bigint; pnl: bigint } | { available: false };

/** Sets Seer's router minted less those it merged, from the option's paired DOWN and UP router transfers. */
const routerSets = (option: TradeOptionDetail) =>
  option.operations.reduce(
    (sum, each) => (each.kind === "mint" ? sum + each.sets : each.kind === "merge" ? sum - each.sets : sum),
    0n,
  );

/**
 * Cost is the predictions' `optionCost`, summed; value marks the held tokens at the pools' spot prices
 * (`underlyingPerOutcome`, 1e18-scaled). Unavailable when a row's sets are not the router's, when the holdings
 * differ from what the sets and swaps moved (a plain transfer or a redemption), or a held side's pool has no price.
 */
export function optionPnl({
  predictions,
  held,
  spot,
}: {
  predictions: TradeOptionDetail[];
  held: Sides<bigint> & {
    /** The child's INVALID; when given, it must be the sets minted less merged, as a set mints and burns it. */
    invalid?: bigint;
  };
  spot: Sides<bigint | null>;
}): OptionPnl {
  if (predictions.some((each) => setsMinted(each) !== routerSets(each))) return { available: false };
  const sets = predictions.reduce((sum, each) => sum + setsMinted(each), 0n);
  const tradedUp = predictions.reduce((sum, each) => sum + each.upSwapTokens, sets);
  const tradedDown = predictions.reduce((sum, each) => sum + each.downSwapTokens, sets);
  if (held.up !== tradedUp || held.down !== tradedDown) return { available: false };
  if (held.invalid !== undefined && held.invalid !== sets) return { available: false };
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

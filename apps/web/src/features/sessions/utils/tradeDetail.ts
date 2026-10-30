import { formatEther } from "viem";

import type { OptionScale } from "@/types/optionScale";

import type { PoolSide, TradeOperation, TradeOption } from "../types";

/** A swap through one of the option's pools, amounts signed from the pool's side as the indexer stores them. */
export interface SwapLog {
  logIndex: number;
  side: PoolSide;
  outcomeAmount: bigint;
  underlyingAmount: bigint;
}

/** The router moving the option's DOWN or UP into the trade wallet (positive) or out of it (negative). */
export interface RouterTransfer {
  logIndex: number;
  side: PoolSide;
  amount: bigint;
}

const abs = (value: bigint) => (value < 0n ? -value : value);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

/**
 * Each swap, mint and merge in log order. A mint is the router handing over DOWN and UP of one amount, a merge
 * is it taking them back; a DOWN or UP move with no matching move of the other side is neither.
 */
export function tradeOperations(swaps: SwapLog[], transfers: RouterTransfer[]): TradeOperation[] {
  const ups = transfers.filter((transfer) => transfer.side === "UP");
  const paired = new Set<RouterTransfer>();
  const sets = transfers
    .filter((transfer) => transfer.side === "DOWN")
    .flatMap((down): TradeOperation[] => {
      const up = ups.find((each) => !paired.has(each) && each.amount === down.amount);
      if (!up) return [];
      paired.add(up);
      const kind = down.amount > 0n ? "mint" : "merge";
      return [{ kind, logIndex: Math.min(down.logIndex, up.logIndex), sets: abs(down.amount) }];
    });
  const swapped = swaps.map((swap): TradeOperation => ({
    kind: "swap",
    logIndex: swap.logIndex,
    side: swap.side,
    // the pool paying outcome tokens out is a buy
    bought: swap.outcomeAmount < 0n,
    tokens: abs(swap.outcomeAmount),
    underlying: abs(swap.underlyingAmount),
  }));
  return [...sets, ...swapped].sort((a, b) => a.logIndex - b.logIndex);
}

/** Underlying per whole token a swap traded at, 1e18-scaled; null for a swap that moved no tokens. */
export const swapPrice = (swap: { tokens: bigint; underlying: bigint }): bigint | null =>
  swap.tokens === 0n ? null : (swap.underlying * 10n ** 18n) / swap.tokens;

/**
 * Sets minted (positive) or merged (negative): DOWN and UP both moving the same way beyond what the swaps
 * moved, by the smaller of the two movements.
 */
export function setsMinted(option: TradeOption): bigint {
  const down = option.downDelta - option.downSwapTokens;
  const up = option.upDelta - option.upSwapTokens;
  if (down > 0n && up > 0n) return min(down, up);
  if (down < 0n && up < 0n) return -min(-down, -up);
  return 0n;
}

/**
 * Underlying the prediction put into this option, in wei: sets minted (less merged) plus what its buys paid, less
 * what its sells returned. Underlying a parent split credited and left unspent is not counted.
 */
export function optionCost(option: TradeOption): bigint {
  return setsMinted(option) - option.upSwapUnderlying - option.downSwapUnderlying;
}

/** The estimate the pool price implies on the option's scale, from UP or else DOWN's mirror; null where neither swapped. */
export function estimateAt(option: TradeOption, scale: OptionScale, moment: "before" | "after"): number | null {
  const up = moment === "before" ? option.upPriceBefore : option.upPriceAfter;
  const down = moment === "before" ? option.downPriceBefore : option.downPriceAfter;
  const span = scale.upperBound - scale.lowerBound;
  if (up !== null) return scale.lowerBound + Number(formatEther(up)) * span;
  if (down !== null) return scale.upperBound - Number(formatEther(down)) * span;
  return null;
}

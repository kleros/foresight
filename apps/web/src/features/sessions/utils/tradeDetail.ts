import { formatEther } from "viem";

import type { OptionScale } from "@/types/optionScale";

import type { PoolSide, TradeOption } from "../types";

/** One side's swaps in a prediction, as their totals; amounts unsigned, in wei, the price 1e18-scaled. */
export interface SideSwap {
  side: PoolSide;
  bought: boolean;
  tokens: bigint;
  underlying: bigint;
  avgPrice: bigint | null;
}

const abs = (value: bigint) => (value < 0n ? -value : value);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

/** UP first, then DOWN; a side that did not swap has no entry. */
export function sideSwaps(option: TradeOption): SideSwap[] {
  const sides = [
    ["UP", option.upSwapTokens, option.upSwapUnderlying, option.upAvgPrice],
    ["DOWN", option.downSwapTokens, option.downSwapUnderlying, option.downAvgPrice],
  ] as const;
  return sides
    .filter(([, tokens]) => tokens !== 0n)
    .map(([side, tokens, underlying, avgPrice]) => ({
      side,
      bought: tokens > 0n,
      tokens: abs(tokens),
      underlying: abs(underlying),
      avgPrice,
    }));
}

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

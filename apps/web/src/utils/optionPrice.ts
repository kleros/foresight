import { formatEther } from "viem";

import type { OptionScale } from "@/types/optionScale";

import { scaleAmount } from "./amount";

/**
 * An outcome token's price is how far up its option's scale the market sits, so the two convert
 * directly. Prices are 1e18-scaled, the form the pools and the indexer both use.
 */

/** A price at either bound needs an unbounded trade to reach, so an estimate stops short of it. */
export const MIN_PRICE_WAD = 10n ** 14n;
export const MAX_PRICE_WAD = 10n ** 18n - MIN_PRICE_WAD;

const WAD = 10n ** 18n;

type Bounds = Pick<OptionScale, "lowerBound" | "upperBound">;

/** Where the option's UP token trades when the market agrees with `estimate`. */
export function estimateToPriceWad(estimate: number, scale: Bounds): bigint {
  const lower = scaleAmount(scale.lowerBound, 18);
  const range = scaleAmount(scale.upperBound, 18) - lower;
  if (range <= 0n) return MIN_PRICE_WAD;

  // integer division: the same step through floats lands a wei out on plain values like 312 of 500
  const price = ((scaleAmount(estimate, 18) - lower) * WAD) / range;

  if (price < MIN_PRICE_WAD) return MIN_PRICE_WAD;
  return price > MAX_PRICE_WAD ? MAX_PRICE_WAD : price;
}

/** The estimate a price stands for, in the option's own unit. */
export function priceWadToEstimate(priceWad: bigint, scale: Bounds): number {
  return scale.lowerBound + Number(formatEther(priceWad)) * (scale.upperBound - scale.lowerBound);
}

import type { OptionScale } from "@/types/optionScale";

import type { SelectedEstimate } from "../types";

/**
 * The resolution every estimate on the page is held at: a power of ten two orders below the
 * scale's width, so a 0-500 scale moves in 1s, 0-10 in 0.1s, 0-1 in 0.01s (100 to 999 steps).
 */
export function estimateStep(scale: Pick<OptionScale, "lowerBound" | "upperBound">): number {
  const range = scale.upperBound - scale.lowerBound;
  return range > 0 ? 10 ** (Math.floor(Math.log10(range)) - 2) : 0;
}

/** Fraction digits that show every grid point; a coarser field would round a saved value on blur. */
export function estimateDigits(scale: Pick<OptionScale, "lowerBound" | "upperBound">): number {
  const step = estimateStep(scale);
  return step > 0 ? Math.max(0, Math.ceil(-Math.log10(step))) : 0;
}

/**
 * Puts a value on the option's grid and inside its bounds. Applied to the market's number as
 * well as the visitor's, so "at the market" means the same thing however the value arrived.
 */
export function snapEstimate(value: number, scale: Pick<OptionScale, "lowerBound" | "upperBound">): number {
  const step = estimateStep(scale);
  if (step <= 0) return scale.lowerBound;

  const snapped = scale.lowerBound + Math.round((value - scale.lowerBound) / step) * step;
  // the multiply leaves binary debris (0.35019999999999996) that would reach a CSV as-is
  return Number(Math.min(scale.upperBound, Math.max(scale.lowerBound, snapped)).toPrecision(12));
}

export function estimateDirection(value: number, marketEstimate: number): SelectedEstimate["direction"] | null {
  if (value > marketEstimate) return "higher";
  if (value < marketEstimate) return "lower";
  return null;
}

/** futarchy-ui's band: within 5 % of the scale's width, the market pin drops under the track. */
export const NEAR_MARKET_SHARE = 0.05;

/** Space kept between the pin's stick and the thumb's number, in px, half the 3px stick included. */
export const STICK_CLEARANCE_PX = 4;

/** The share of the track either side of the thumb that its number covers, with the stick's clearance; 0 until measured. */
export function stickClearShare(px: { track: number; label: number }): number {
  return px.track > 0 ? (px.label / 2 + STICK_CLEARANCE_PX) / px.track : 0;
}

/** `band` widens futarchy's 5 % on a track narrow enough that the stick would run through the thumb's number. */
export function isNearMarket(
  value: number,
  marketEstimate: number,
  scale: Pick<OptionScale, "lowerBound" | "upperBound">,
  band = NEAR_MARKET_SHARE,
): boolean {
  const share = Math.max(band, NEAR_MARKET_SHARE);
  return Math.abs(value - marketEstimate) <= share * (scale.upperBound - scale.lowerBound);
}

/**
 * The estimates that would become predictions: set on an option that is trading, and away
 * from where the market already sits. Order follows `scales`.
 */
export function selectedEstimates(
  scales: OptionScale[],
  estimates: Record<string, number>,
  marketEstimates: Record<string, number | undefined>,
): SelectedEstimate[] {
  const selected: SelectedEstimate[] = [];
  for (const scale of scales) {
    const key = scale.market.toLowerCase();
    const value = estimates[key];
    const marketEstimate = marketEstimates[key];
    if (value === undefined || marketEstimate === undefined) continue;

    const direction = estimateDirection(value, marketEstimate);
    if (direction === null) continue;

    selected.push({ scale, value, marketEstimate, direction });
  }

  return selected;
}

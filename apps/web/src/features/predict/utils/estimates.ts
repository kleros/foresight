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

const GROUPED = /^-?[1-9]\d{0,2}(,\d{3})+(\.\d*)?$/;
// three digits after the comma would be a group, which only "0," or no whole part can rule out
const DECIMAL_COMMA = /^-?(\d*,(\d{1,2}|\d{4,})|0?,\d{3})$/;
const SPACE_GROUPED = /^-?\d{1,3}(\s\d{3})+([.,]\d+)?$/;
const PLAIN = /^-?(\d+\.?\d*|\.\d+)$/;

/**
 * A typed estimate, unit, a leading plus and spaces between groups of three allowed; NaN for anything but
 * a decimal number. Commas before each group of three digits group thousands; any other single comma is the decimal point.
 */
export function readTypedEstimate(text: string, unit: string | null): number {
  const trimmed = (unit ? text.split(unit).join("") : text).trim().replace(/^\+(?=[\d.,])/, "");
  if (/\s/.test(trimmed) && !SPACE_GROUPED.test(trimmed)) return Number.NaN;
  const bare = trimmed.replace(/\s/g, "");
  const dotted = GROUPED.test(bare) ? bare.replace(/,/g, "") : DECIMAL_COMMA.test(bare) ? bare.replace(",", ".") : bare;
  return PLAIN.test(dotted) ? Number(dotted) : Number.NaN;
}

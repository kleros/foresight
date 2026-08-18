import type { BoundsWei } from "./branchFields";
import { formatWeiAmount } from "./scaleToWei";

/**
 * What a branch pays, in the numbers its creator typed. A scalar market pays one
 * side in full for any answer past a bound.
 */

export type ResolutionExample = { midpoint: string; floor: string; ceiling: string };

export function resolutionExample(bounds: BoundsWei, unit: string): ResolutionExample | null {
  const { lower, upper } = bounds;
  if (lower === null || upper === null || lower >= upper) return null;

  const withUnit = (wei: bigint) => `${formatWeiAmount(wei)}${unit.trim() ? ` ${unit.trim()}` : ""}`;
  return {
    midpoint: withUnit((lower + upper) / 2n),
    floor: withUnit(lower),
    ceiling: withUnit(upper),
  };
}

import type { OptionScale } from "@/types/optionScale";

import type { SelectedEstimate } from "../types";

const WAD = 10n ** 18n;

/** Decimals a position is shown at. */
export const POSITION_DIGITS = 2;

/** What a trade wallet holds of one option's UP and DOWN tokens, in base units. */
export interface OptionPosition {
  up: bigint;
  down: bigint;
}

/**
 * What the position pays out if the option resolves at `estimate`, in the option's own outcome
 * token: each UP pays the estimate's share of the scale, each DOWN the rest.
 */
export function positionWorth(
  position: OptionPosition,
  estimate: number,
  scale: Pick<OptionScale, "lowerBound" | "upperBound">,
): bigint {
  const range = scale.upperBound - scale.lowerBound;
  const share = range > 0 ? Math.min(1, Math.max(0, (estimate - scale.lowerBound) / range)) : 0;
  // a share in millionths keeps the float's debris out of the wad
  const upWad = (BigInt(Math.round(share * 1e6)) * WAD) / 1_000_000n;
  return (position.up * upWad + position.down * (WAD - upWad)) / WAD;
}

/** The side the position is weighted to, which is the side the visitor predicted. */
export function positionLeaning(position: OptionPosition): SelectedEstimate["direction"] | null {
  if (position.up > position.down) return "higher";
  if (position.down > position.up) return "lower";
  return null;
}

/** False for a holding that would read "0 UP · 0 DOWN" at POSITION_DIGITS. */
export function isShownPosition(position: OptionPosition, decimals: number): boolean {
  const least = 10n ** BigInt(Math.max(decimals - POSITION_DIGITS, 0));
  return position.up >= least || position.down >= least;
}

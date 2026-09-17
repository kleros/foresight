import { NumberField, Slider } from "@kleros/ui-components-library";
import clsx from "clsx";

import { getReadableTextColor } from "@/utils/branchColor";
import { formatEstimate } from "@/utils/formatEstimate";

import type { OptionScale } from "@/types/optionScale";

import { estimateDigits, estimateDirection, estimateStep, snapEstimate } from "../utils/estimates";

interface EstimateSliderProps {
  scale: OptionScale;
  /** Where the market sits now; undefined where the option has no trading. */
  marketEstimate: number | undefined;
  isMarketPending: boolean;
  /** The saved estimate, if one is set. */
  value: number | undefined;
  onCommit: (value: number) => void;
  onClear: () => void;
  /** Set when the session as a whole cannot take estimates; shown in place of the input. */
  lockedReason?: string;
}

/**
 * An estimate on the option's own scale: the market's number marked on the track, the
 * visitor's as the thumb, and a field for typing it exactly.
 */
export function EstimateSlider({
  scale,
  marketEstimate,
  isMarketPending,
  value,
  onCommit,
  onClear,
  lockedReason,
}: EstimateSliderProps) {
  const range = scale.upperBound - scale.lowerBound;
  // react-aria snaps a controlled value to the step, so the market's number is held on the same grid
  const step = estimateStep(scale);
  const shown = value ?? marketEstimate ?? scale.lowerBound + range / 2;
  const reason =
    lockedReason ??
    (marketEstimate === undefined && !isMarketPending ? "No trading is available for this option yet." : undefined);
  const isDisabled = reason !== undefined || isMarketPending;

  const commit = (next: number) => {
    const snapped = snapEstimate(next, scale);
    if (marketEstimate !== undefined && snapped === marketEstimate) onClear();
    else onCommit(snapped);
  };

  const direction =
    value !== undefined && marketEstimate !== undefined ? estimateDirection(value, marketEstimate) : null;
  const marketAt = marketEstimate === undefined ? undefined : ((marketEstimate - scale.lowerBound) / range) * 100;

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="relative w-full">
        <Slider
          className={clsx("w-full", "[&_#slider-label]:text-fs-text-primary! [&_#slider-label]:font-semibold")}
          aria-label={`Your estimate for ${scale.name}`}
          minValue={scale.lowerBound}
          maxValue={scale.upperBound}
          step={step}
          value={shown}
          leftLabel=""
          rightLabel=""
          formatter={(amount) => formatEstimate(amount, scale.unit)}
          callback={commit}
          isDisabled={isDisabled}
        />
        <div className="relative h-14 w-full">
          {marketAt !== undefined ? (
            <div
              className="pointer-events-none absolute top-0 flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${marketAt}%` }}
            >
              <span className="bg-fs-text-primary block h-4 w-0.5 rounded-b-full" aria-hidden />
              <span
                className="rounded-fs px-2 py-0.5 text-center text-xs whitespace-nowrap"
                style={{ backgroundColor: scale.color, color: getReadableTextColor(scale.color) }}
              >
                Market {formatEstimate(marketEstimate!, scale.unit)}
              </span>
            </div>
          ) : null}
        </div>
        <div className="type-caption text-fs-text-secondary flex justify-between">
          <span>{formatEstimate(scale.lowerBound, scale.unit)}</span>
          <span>{formatEstimate(scale.upperBound, scale.unit)}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <NumberField
          label="Your estimate"
          value={shown}
          minValue={scale.lowerBound}
          maxValue={scale.upperBound}
          formatOptions={{ maximumFractionDigits: estimateDigits(scale) }}
          onChange={(typed) => (Number.isNaN(typed) ? onClear() : commit(typed))}
          isDisabled={isDisabled}
          className="w-44"
        />
        <p className="type-caption text-fs-text-secondary pb-2">
          {reason ??
            (isMarketPending ? (
              "Loading the market estimate…"
            ) : direction === "higher" ? (
              <span className="text-fs-tone-success">Higher than the market estimate</span>
            ) : direction === "lower" ? (
              <span className="text-fs-tone-error">Lower than the market estimate</span>
            ) : (
              "At the market estimate. Move it to make a prediction."
            ))}
        </p>
      </div>
    </div>
  );
}

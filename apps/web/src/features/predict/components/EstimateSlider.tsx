import { NumberField, Slider } from "@kleros/ui-components-library";
import clsx from "clsx";

import ArrowDown from "@/assets/svg/long-arrow-down.svg";
import ArrowUp from "@/assets/svg/long-arrow-up.svg";

import { getReadableTextColor } from "@/utils/branchColor";
import { formatEstimate } from "@/utils/formatEstimate";

import type { OptionScale } from "@/types/optionScale";

import { usePinBand } from "../hooks/usePinBand";
import { estimateDigits, estimateDirection, estimateStep, isNearMarket, snapEstimate } from "../utils/estimates";

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

const ESTIMATE_COLOR = { higher: "var(--fs-estimate-up)", lower: "var(--fs-estimate-down)" } as const;

/**
 * An estimate on the option's own scale, drawn as futarchy-ui draws it: the fill and thumb take
 * the direction's colour, and the market's pin drops under the track when the thumb comes near it,
 * or near enough on a narrow track that the pin would cover the thumb's label.
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

  const direction = marketEstimate !== undefined ? estimateDirection(shown, marketEstimate) : null;
  const tone = direction && !isDisabled ? ESTIMATE_COLOR[direction] : undefined;
  const marketAt = marketEstimate === undefined ? undefined : ((marketEstimate - scale.lowerBound) / range) * 100;
  const pin = usePinBand(shown, marketAt === undefined ? undefined : marketAt / 100);
  const pinDown = marketEstimate !== undefined && isNearMarket(shown, marketEstimate, scale, pin.band);

  return (
    <div className="flex w-full flex-col gap-4">
      {/* pt-8 holds the thumb's floating label and the raised pin; pb-1 the dropped pin */}
      <div className="w-full pt-8 pb-1">
        <div ref={pin.track} className="relative w-full">
          <Slider
            className={clsx(
              "w-full",
              "[&_#slider-label]:text-fs-text-primary! [&_#slider-label]:font-semibold",
              // the library gives the thumb no id; it is the element holding #slider-label
              "[&_div:has(>#slider-label)]:before:absolute [&_div:has(>#slider-label)]:before:-inset-2.5",
              "[&_div:has(>#slider-label)]:before:content-['']",
              "[&_div:has(>#slider-label)[data-focus-visible]]:ring-fs-accent",
              "[&_div:has(>#slider-label)[data-focus-visible]]:ring-2",
              "[&_div:has(>#slider-label)[data-focus-visible]]:ring-offset-2",
              "[&_div:has(>#slider-label)[data-focus-visible]]:ring-offset-fs-surface-sunken",
              isDisabled && "opacity-50",
            )}
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
            theme={
              tone
                ? {
                    sliderColor: tone,
                    thumbColor: tone,
                    trackColor: "var(--fs-border)",
                    labelColor: "var(--fs-text-primary)",
                  }
                : undefined
            }
          />
          {marketAt !== undefined ? (
            <div
              data-testid="market-pin"
              data-placement={pinDown ? "down" : "up"}
              className={clsx(
                // up: chip and stick end at the track's lower edge (18px); down: the chip starts 4px under the thumb
                "pointer-events-none absolute -top-6 flex -translate-x-1/2 items-center",
                "transition-transform duration-(--fs-dur-enter) ease-(--fs-ease-enter)",
                pinDown ? "translate-y-13.5 flex-col-reverse" : "flex-col",
              )}
              style={{ left: `${marketAt}%` }}
            >
              <span
                ref={pin.chip}
                className="rounded-fs px-2 py-0.75 text-center text-xs whitespace-nowrap"
                style={{ backgroundColor: scale.color, color: getReadableTextColor(scale.color) }}
              >
                Market {formatEstimate(marketEstimate!, scale.unit)}
              </span>
              <span
                className={clsx("bg-fs-text-primary block h-5 w-0.75 rounded-b-full", pinDown && "hidden")}
                aria-hidden
              />
            </div>
          ) : null}
          <div className="type-caption text-fs-text-secondary flex justify-between">
            {/* a dropped pin names its own point, so the bound under its chip steps aside */}
            <span data-bound="lower" className={clsx(pinDown && pin.covers.lower && "invisible")}>
              {formatEstimate(scale.lowerBound, scale.unit)}
            </span>
            <span data-bound="upper" className={clsx(pinDown && pin.covers.upper && "invisible")}>
              {formatEstimate(scale.upperBound, scale.unit)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div className="flex items-end gap-2">
          <NumberField
            label="Your estimate"
            value={shown}
            minValue={scale.lowerBound}
            maxValue={scale.upperBound}
            formatOptions={{ maximumFractionDigits: estimateDigits(scale) }}
            onChange={(typed) => (Number.isNaN(typed) ? onClear() : commit(typed))}
            isDisabled={isDisabled}
            className={clsx("[&_label]:text-fs-text-secondary w-44", isDisabled && "opacity-50")}
          />
          {scale.unit ? (
            <span data-testid="estimate-unit" className="type-label text-fs-text-secondary pb-3">
              {scale.unit}
            </span>
          ) : null}
        </div>
        <p className="type-label text-fs-text-secondary pb-3">
          {reason ? (
            <span className={lockedReason ? "text-fs-tone-warning-text" : undefined}>{reason}</span>
          ) : isMarketPending ? (
            "Loading the market estimate…"
          ) : direction !== null && marketEstimate !== undefined ? (
            <DirectionHint
              direction={direction}
              gap={Math.abs(shown - marketEstimate)}
              market={marketEstimate}
              unit={scale.unit}
            />
          ) : (
            "At the market estimate. Move it to make a prediction."
          )}
        </p>
      </div>
    </div>
  );
}

function DirectionHint({
  direction,
  gap,
  market,
  unit,
}: {
  direction: "higher" | "lower";
  gap: number;
  market: number;
  unit: string | null;
}) {
  const higher = direction === "higher";
  const Arrow = higher ? ArrowUp : ArrowDown;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1",
        higher ? "text-fs-tone-success-text" : "text-fs-tone-error-text",
      )}
    >
      <Arrow className="size-3 shrink-0 [&_path]:fill-current" aria-hidden />
      {`${formatEstimate(gap, unit)} ${higher ? "above" : "below"} the market (${formatEstimate(market, unit)})`}
    </span>
  );
}

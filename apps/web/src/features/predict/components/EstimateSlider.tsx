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
 * the direction's colour, and once an estimate is set the market's pin drops under the track
 * while the thumb is near it.
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
  const atRest = value === undefined && marketEstimate !== undefined;
  const pinDown =
    value !== undefined && marketEstimate !== undefined && isNearMarket(shown, marketEstimate, scale, pin.band);

  return (
    <div className="flex w-full flex-col gap-4">
      {/* pt-16 holds the raised pin above the thumb's number; pb-3 the dropped pin's caption */}
      <div className="w-full pt-16 pb-3">
        <div ref={pin.track} className="relative w-full">
          <Slider
            className={clsx(
              "w-full",
              "[&_#slider-label]:text-fs-text-primary! [&_#slider-label]:font-semibold",
              // with no estimate set the thumb sits on the market, whose number the pin already shows
              atRest && "[&_#slider-label]:invisible",
              // the library gives the thumb no id; it is the element holding #slider-label
              // above the track, with a 44px target: the inset counts from inside its 3px border
              "[&_div:has(>#slider-label)]:z-10",
              "[&_div:has(>#slider-label)]:before:absolute [&_div:has(>#slider-label)]:before:-inset-3.25",
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
                // up: caption, chip and stick end at the track's lower edge, the chip above the thumb's number;
                // down: the chip sits 2px under the thumb with the caption beneath it
                "pointer-events-none absolute -top-15.5 w-0",
                "transition-transform duration-(--fs-dur-enter) ease-(--fs-ease-structural) motion-reduce:transition-none",
                pinDown && "translate-y-18.5",
              )}
              style={{ left: `${marketAt}%` }}
            >
              {/* only the chip is in flow, so the caption changing sides never shifts it */}
              <div
                ref={pin.chip}
                className="absolute top-4 left-0 flex w-max flex-col items-center"
                style={{ transform: pin.chipShift === undefined ? "translateX(-50%)" : `translateX(${pin.chipShift}px)` }}
              >
                <span
                  data-testid="market-chip"
                  className="rounded-fs px-2 py-0.5 text-center text-xs leading-4 whitespace-nowrap"
                  style={{ backgroundColor: scale.color, color: getReadableTextColor(scale.color) }}
                >
                  {formatEstimate(marketEstimate!, scale.unit)}
                </span>
                {/* holds the chip at least as wide as its caption */}
                <span className="invisible h-0 text-xs" aria-hidden>
                  Market
                </span>
                {(["up", "down"] as const).map((side) => (
                  <span
                    key={side}
                    aria-hidden={(side === "down") !== pinDown}
                    className={clsx(
                      "text-fs-text-primary absolute text-xs leading-4",
                      side === "up" ? "bottom-full" : "top-full",
                      "transition-opacity duration-(--fs-dur-echo) ease-(--fs-ease-enter)",
                      // the arriving caption waits out the leaving one, so it never crosses the thumb's number
                      (side === "down") === pinDown ? "opacity-100 delay-(--fs-dur-echo)" : "opacity-0",
                    )}
                  >
                    Market
                  </span>
                ))}
              </div>
              <span
                data-testid="market-stick"
                className={clsx(
                  "bg-fs-text-primary absolute top-9 -left-[1.5px] block h-11 w-0.75 rounded-b-full",
                  "transition-opacity duration-(--fs-dur-echo) ease-(--fs-ease-enter)",
                  pinDown && "opacity-0",
                )}
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
            "At the market. Move it to predict."
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

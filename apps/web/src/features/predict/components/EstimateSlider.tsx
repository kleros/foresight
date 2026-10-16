import { forwardRef, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Slider } from "@kleros/ui-components-library";
import clsx from "clsx";

import ArrowDown from "@/assets/svg/long-arrow-down.svg";
import ArrowUp from "@/assets/svg/long-arrow-up.svg";
import PencilIcon from "@/assets/svg/pencil.svg";

import { getReadableTextColor } from "@/utils/branchColor";
import { formatEstimate } from "@/utils/formatEstimate";

import type { OptionScale } from "@/types/optionScale";

import { useMarketPin } from "../hooks/useMarketPin";
import { estimateDigits, estimateDirection, estimateStep, readTypedEstimate, snapEstimate } from "../utils/estimates";
import { chipLeft, droppedChipLeft, pinDrop, pinGap } from "../utils/marketPin";

interface EstimateSliderProps {
  scale: OptionScale;
  /** Where the market sits now; undefined where the option has no trading. */
  marketEstimate: number | undefined;
  isMarketPending: boolean;
  /** The saved estimate, if one is set. */
  value: number | undefined;
  onCommit: (value: number) => void;
  onClear: () => void;
  /** Set when the session as a whole cannot take estimates; shown in place of the hint. */
  lockedReason?: string;
}

const ESTIMATE_COLOR = { higher: "var(--fs-estimate-up)", lower: "var(--fs-estimate-down)" } as const;

/** The chip's travel from its place above the track to 2px under the thumb, in px. */
const PIN_DROP_PX = 52;
/** The stick from the raised chip down to the track, in px. */
const STICK_PX = 14;

/**
 * An estimate on the option's own scale, drawn as futarchy-ui draws it: the fill and thumb take
 * the direction's colour, and the market's pin dips as the thumb's value nears it and drops under the track once it is close.
 * The value above the thumb is a pill that opens as a field; a typed number is applied on Enter or blur.
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
    lockedReason ?? (marketEstimate === undefined && !isMarketPending ? "No trading on this option yet." : undefined);
  const isDisabled = reason !== undefined || isMarketPending;
  const [note, setNote] = useState<string>();
  // held here, so the pin measures the open field's width
  const [draft, setDraft] = useState<string>();
  // a field open when the slider locks is dropped, not reopened once it unlocks
  if (isDisabled && draft !== undefined) setDraft(undefined);

  // a note answers one entry, so the next focus or press hands the line back to the hint;
  // listening from the next task leaves out the focus and press that delivered it
  useEffect(() => {
    if (!note) return;
    const clear = () => setNote(undefined);
    const events = ["focusin", "focusout", "pointerdown"] as const;
    const timer = setTimeout(() => events.forEach((name) => document.addEventListener(name, clear)));
    return () => {
      clearTimeout(timer);
      events.forEach((name) => document.removeEventListener(name, clear));
    };
  }, [note]);

  const commit = (next: number) => {
    const snapped = snapEstimate(next, scale);
    if (marketEstimate !== undefined && snapped === marketEstimate) onClear();
    else onCommit(snapped);
  };

  const direction = marketEstimate !== undefined ? estimateDirection(shown, marketEstimate) : null;
  const tone = direction && !isDisabled ? ESTIMATE_COLOR[direction] : undefined;
  const thumbShare = (shown - scale.lowerBound) / range;
  const marketShare = marketEstimate === undefined ? undefined : (marketEstimate - scale.lowerBound) / range;
  const pin = useMarketPin({ holdPill: draft !== undefined });
  const drop = marketShare === undefined ? 0 : pinDrop(pinGap(pin.sizes, { thumb: thumbShare, market: marketShare }));
  const isDown = drop === 1;
  const chipAt =
    marketShare === undefined
      ? 0
      : isDown
        ? droppedChipLeft(pin.sizes, marketShare)
        : chipLeft(pin.sizes, marketShare);
  const covers = {
    lower: pin.sizes.track > 0 && chipAt < pin.sizes.lower,
    upper: pin.sizes.track > 0 && chipAt + pin.sizes.chip > pin.sizes.track - pin.sizes.upper,
  };
  const dipPx = drop * PIN_DROP_PX;

  return (
    <div className="flex w-full flex-col gap-4">
      {/* pt-10 holds the raised pin's caption, pb-3 the dropped one's */}
      <div className="w-full pt-10 pb-3">
        <div ref={pin.track} className="relative w-full">
          <Slider
            className={clsx(
              "w-full",
              // the pill below shows the value
              "[&_#slider-label]:hidden",
              // the library gives the thumb no id; it is the element holding #slider-label,
              // with a 44px target: the inset counts from inside its 3px border
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
            callback={(next) => {
              setNote(undefined);
              commit(next);
            }}
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
          {isDisabled && value !== undefined ? (
            <span
              ref={pin.pill}
              data-testid="value-pill"
              className="border-fs-border bg-fs-surface text-fs-text-primary absolute -top-8 z-9 inline-flex h-7 items-center rounded-full border px-2.5 text-sm font-semibold whitespace-nowrap tabular-nums opacity-50"
              style={{ left: `${thumbShare * 100}%`, transform: `translateX(-${thumbShare * 100}%)` }}
            >
              {formatEstimate(shown, scale.unit)}
            </span>
          ) : null}
          {!isDisabled ? (
            <ValuePill
              ref={pin.pill}
              share={thumbShare}
              shown={shown}
              scale={scale}
              draft={draft}
              minWidth={pin.sizes.pill}
              onDraft={setDraft}
              onOpen={() => setNote(undefined)}
              onCancel={() => setNote(undefined)}
              onTyped={(typed) => {
                const clamped = Math.min(scale.upperBound, Math.max(scale.lowerBound, typed));
                const snapped = snapEstimate(clamped, scale);
                const named = (point: number) => formatEstimate(point, scale.unit, estimateDigits(scale));
                setNote(
                  typed > scale.upperBound
                    ? `The most is ${named(snapped)}.`
                    : typed < scale.lowerBound
                      ? `The least is ${named(snapped)}.`
                      : snapped !== clamped
                        ? `Rounded to ${named(snapped)}.`
                        : undefined,
                );
                commit(snapped);
              }}
              onInvalid={setNote}
            />
          ) : null}
          {marketShare !== undefined ? (
            <div
              data-testid="market-pin"
              data-placement={isDown ? "down" : "up"}
              data-drop={drop.toFixed(3)}
              className={clsx(
                // the chip's raised place: its foot level with the pill's, the stick running down to the track
                "pointer-events-none absolute -top-6 w-0",
                pin.ready &&
                  "transition-transform duration-(--fs-dur-structural) ease-(--fs-ease-spring) motion-reduce:transition-none",
              )}
              style={{ left: `${marketShare * 100}%`, transform: `translateY(${dipPx}px)` }}
            >
              {/* only the chip is in flow, so the caption changing sides never shifts it */}
              <div
                ref={pin.chip}
                className={clsx(
                  "absolute top-0 left-0 flex w-max flex-col items-center",
                  pin.ready &&
                    "transition-transform duration-(--fs-dur-structural) ease-(--fs-ease-spring) motion-reduce:transition-none",
                )}
                style={{
                  transform:
                    pin.sizes.track > 0
                      ? `translateX(${chipAt - marketShare * pin.sizes.track}px)`
                      : "translateX(-50%)",
                }}
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
                    aria-hidden={(side === "down") !== isDown}
                    className={clsx(
                      "text-fs-text-primary absolute text-xs leading-4",
                      side === "up" ? "bottom-full" : "top-full",
                      "transition-opacity duration-(--fs-dur-echo) ease-(--fs-ease-enter)",
                      // the arriving caption waits out the leaving one, so the two never show at once
                      (side === "down") === isDown ? "opacity-100 delay-(--fs-dur-echo)" : "opacity-0",
                    )}
                  >
                    Market
                  </span>
                ))}
              </div>
              <span
                data-testid="market-stick"
                className={clsx(
                  "bg-fs-text-primary absolute top-5 -left-[1.5px] block h-3.5 w-0.75 origin-top rounded-b-full",
                  pin.ready &&
                    "transition-[transform,opacity] duration-(--fs-dur-structural) ease-(--fs-ease-spring) motion-reduce:transition-none",
                )}
                style={{
                  // shortens as the pin dips, so its foot stays on the track
                  transform: `scaleY(${Math.max(STICK_PX - dipPx, 0) / STICK_PX})`,
                  opacity: isDown ? 0 : 1,
                }}
                aria-hidden
              />
            </div>
          ) : null}
          <div className="type-caption text-fs-text-secondary flex justify-between">
            {/* a dropped chip that cannot slide clear of a bound covers it, so the bound steps aside */}
            <span data-bound="lower" className={clsx(isDown && covers.lower && "invisible")}>
              {formatEstimate(snapEstimate(scale.lowerBound, scale), scale.unit)}
            </span>
            <span data-bound="upper" className={clsx(isDown && covers.upper && "invisible")}>
              {formatEstimate(snapEstimate(scale.upperBound, scale), scale.unit)}
            </span>
          </div>
        </div>
      </div>

      <p className="type-label text-fs-text-secondary min-h-5">
        {/* mounted empty, so a screen reader hears the note when it arrives */}
        <span role="status">{note}</span>
        {note ? null : reason ? (
          <span className={lockedReason ? "text-fs-tone-warning-text" : undefined}>{reason}</span>
        ) : isMarketPending ? (
          "Loading the market…"
        ) : direction !== null && marketEstimate !== undefined ? (
          <DirectionHint direction={direction} gap={Math.abs(shown - marketEstimate)} unit={scale.unit} />
        ) : (
          "At the market. Move it to predict."
        )}
      </p>
    </div>
  );
}

interface ValuePillProps {
  /** The thumb's place on the track, 0 to 1. */
  share: number;
  shown: number;
  scale: OptionScale;
  /** The field's text while it is open. */
  draft: string | undefined;
  /** The closed pill's width in px; the open field is never narrower, so opening it moves nothing. */
  minWidth: number;
  onDraft: (draft: string | undefined) => void;
  onOpen: () => void;
  /** The field closed without a number applied. */
  onCancel: () => void;
  onTyped: (value: number) => void;
  onInvalid: (message: string) => void;
}

const ValuePill = forwardRef<HTMLSpanElement, ValuePillProps>(function ValuePill(
  { share, shown, scale, draft, minWidth, onDraft: setDraft, onOpen, onCancel, onTyped, onInvalid },
  ref,
) {
  const button = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const editing = draft !== undefined;

  useEffect(() => {
    if (editing || !returnFocus.current) return;
    returnFocus.current = false;
    button.current?.focus();
  }, [editing]);

  const close = (refocus: boolean) => {
    returnFocus.current = refocus;
    setDraft(undefined);
  };

  const cancel = (refocus: boolean) => {
    onCancel();
    close(refocus);
  };

  /** Enter keeps the field open on text that is not a number; a blur closes it unchanged. */
  const apply = (byEnter: boolean) => {
    const typed = readTypedEstimate(draft ?? "", scale.unit);
    if ((draft ?? "").trim() === "") return cancel(byEnter);
    if (!Number.isFinite(typed)) return byEnter ? onInvalid("Enter a number.") : cancel(false);
    onTyped(typed);
    close(byEnter);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      apply(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel(true);
    }
  };

  return (
    <span
      ref={ref}
      data-testid="value-pill"
      // slides across the track with the thumb, so the pill never leaves it and its foot stays over the thumb;
      // under the thumb's z-10, so a press on the thumb's 44px target drags rather than opens the field
      className="absolute -top-8 z-9"
      style={{ left: `${share * 100}%`, transform: `translateX(-${share * 100}%)` }}
    >
      {editing ? (
        <span
          className="border-fs-accent bg-fs-surface rounded-full inline-flex h-7 items-center gap-1 border px-2.5 text-sm"
          style={{ minWidth }}
        >
          <input
            autoFocus
            aria-label={`Your estimate for ${scale.name}`}
            inputMode="decimal"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => apply(false)}
            onFocus={(event) => event.target.select()}
            // as wide as what is typed, so the unit stays beside the number
            style={{ width: `calc(${Math.min(Math.max((draft ?? "").length, 2), 14)}ch + 2px)` }}
            className="text-fs-text-primary bg-transparent font-semibold tabular-nums outline-none"
          />
          {scale.unit ? <span className="text-fs-text-secondary">{scale.unit}</span> : null}
        </span>
      ) : (
        <button
          ref={button}
          type="button"
          aria-label={`${formatEstimate(shown, scale.unit)}, type your estimate for ${scale.name}`}
          onClick={() => {
            onOpen();
            setDraft(String(Number(shown.toFixed(estimateDigits(scale)))));
          }}
          className={clsx(
            "border-fs-border bg-fs-surface text-fs-text-primary rounded-full fs-echo relative",
            // reaches 8px up into the padding above, so the pill's target is taller than it draws
            "before:absolute before:inset-x-0 before:-top-2 before:bottom-0 before:content-['']",
            "inline-flex h-7 cursor-pointer items-center gap-1.5 border px-2.5 text-sm font-semibold whitespace-nowrap tabular-nums",
            "hover:border-fs-accent focus-visible:ring-fs-accent focus-visible:ring-2 focus-visible:outline-none",
          )}
        >
          {formatEstimate(shown, scale.unit)}
          <PencilIcon className="text-fs-text-secondary size-3" aria-hidden />
        </button>
      )}
    </span>
  );
});

function DirectionHint({ direction, gap, unit }: { direction: "higher" | "lower"; gap: number; unit: string | null }) {
  const higher = direction === "higher";
  const Arrow = higher ? ArrowUp : ArrowDown;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 align-top",
        higher ? "text-fs-tone-success-text" : "text-fs-tone-error-text",
      )}
    >
      <Arrow className="size-3 shrink-0 [&_path]:fill-current" aria-hidden />
      {`${formatEstimate(gap, unit)} ${higher ? "above" : "below"} the market`}
    </span>
  );
}

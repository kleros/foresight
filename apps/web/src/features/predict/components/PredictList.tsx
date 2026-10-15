import { useEffect, useRef, useState } from "react";

import clsx from "clsx";

import LightButton from "@/components/ui/LightButton";

import CloseIcon from "@/assets/svg/close.svg";
import ArrowDown from "@/assets/svg/long-arrow-down.svg";
import ArrowUp from "@/assets/svg/long-arrow-up.svg";

import { formatEstimate } from "@/utils/formatEstimate";

import type { SelectedEstimate } from "../types";

/** An estimate as the list shows it; a stored run's has no market estimate to compare against. */
export type ListedEstimate = Pick<SelectedEstimate, "scale" | "value"> &
  Partial<Pick<SelectedEstimate, "direction" | "marketEstimate">>;

/** An option's market estimate before and after the prediction, in the option's unit. */
export interface PriceMove {
  from: number;
  to: number;
}

/** --fs-dur-echo in ms, the length of a row's exit; 0 where no stylesheet sets it. */
function exitMs(): number {
  const token = getComputedStyle(document.documentElement).getPropertyValue("--fs-dur-echo").trim();
  const ms = token.endsWith("ms") ? parseFloat(token) : token.endsWith("s") ? parseFloat(token) * 1000 : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/** The estimates going into the popup, one row each, removable while more than one is left. */
export function PredictList({
  selected,
  onRemove,
  isReadOnly,
  isFixed = false,
  preview = {},
}: {
  selected: ListedEstimate[];
  onRemove: (market: string) => void;
  isReadOnly: boolean;
  /** A stored run's estimates, which offer no remove at all. */
  isFixed?: boolean;
  /** Keyed by lower-case market; an option without an entry shows where its market is now. */
  preview?: Record<string, PriceMove>;
}) {
  const [leaving, setLeaving] = useState<string[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const readOnly = useRef(isReadOnly);
  useEffect(() => {
    readOnly.current = isReadOnly;
  }, [isReadOnly]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const remove = (market: string) => {
    if (leaving.includes(market)) return;
    setLeaving((markets) => [...markets, market]);
    // the token is 1ms under reduced motion
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setLeaving((markets) => markets.filter((other) => other !== market));
      // a run that started during the exit has already taken this estimate in
      if (!readOnly.current) onRemove(market);
    }, exitMs());
    timers.current.add(timer);
  };
  // the last estimate is never removed, counting the ones on their way out
  const removable = selected.length - leaving.length > 1;

  return (
    <ul
      className={clsx(
        "grid w-full gap-x-2.5",
        "grid-cols-[8px_minmax(0,1fr)_max-content_28px] sm:grid-cols-[8px_minmax(96px,1fr)_max-content_minmax(0,max-content)_28px]",
      )}
    >
      {selected.map((estimate) => (
        <EstimateRow
          key={estimate.scale.market}
          estimate={estimate}
          move={preview[estimate.scale.market.toLowerCase()]}
          onRemove={removable ? () => remove(estimate.scale.market) : undefined}
          hasRemove={selected.length > 1 && !isFixed}
          isLeaving={leaving.includes(estimate.scale.market)}
          isReadOnly={isReadOnly}
        />
      ))}
    </ul>
  );
}

/** Where the market goes: `Market 75 → 80 %`, `from 75 %` once it reaches the estimate, `Market at 75 %` when it does not move. */
export function marketCaption(estimate: ListedEstimate, move: PriceMove | undefined): string {
  const { unit } = estimate.scale;
  const format = (value: number) => formatEstimate(value, unit);
  if (move && format(move.from) !== format(move.to)) {
    return format(move.to) === format(estimate.value)
      ? `from ${format(move.from)}`
      : `Market ${formatEstimate(move.from, null)} → ${format(move.to)}`;
  }
  return estimate.marketEstimate !== undefined ? `Market at ${format(estimate.marketEstimate)}` : "";
}

function EstimateRow({
  estimate,
  move,
  onRemove,
  hasRemove,
  isLeaving,
  isReadOnly,
}: {
  estimate: ListedEstimate;
  move: PriceMove | undefined;
  onRemove?: () => void;
  hasRemove: boolean;
  isLeaving: boolean;
  isReadOnly: boolean;
}) {
  const { scale } = estimate;
  const higher = estimate.direction === "higher";
  const Arrow = higher ? ArrowUp : ArrowDown;
  const where = marketCaption(estimate, move);

  return (
    <li
      data-leaving={isLeaving || undefined}
      className={clsx(
        "col-span-full grid grid-cols-subgrid items-center text-sm leading-5",
        "h-9 grid-rows-[20px_16px] sm:h-8 sm:grid-rows-1",
        "transition-[opacity,transform] duration-(--fs-dur-echo) ease-(--fs-ease-exit)",
        "data-leaving:scale-[.97] data-leaving:opacity-0 motion-reduce:data-leaving:scale-100",
      )}
    >
      <span
        className="size-2 rounded-full [grid-area:1/1] sm:[grid-area:auto]"
        style={{ backgroundColor: scale.color }}
        aria-hidden
      />
      <span
        className="text-fs-text-primary min-w-0 truncate font-semibold [grid-area:1/2] sm:[grid-area:auto]"
        title={scale.name}
      >
        {scale.name}
      </span>
      <span className="text-fs-text-primary inline-flex items-center gap-1.5 justify-self-end font-semibold whitespace-nowrap tabular-nums [grid-area:1/3] sm:[grid-area:auto]">
        {formatEstimate(estimate.value, scale.unit)}
        {estimate.direction ? (
          <Arrow
            role="img"
            aria-label={higher ? "above the market" : "below the market"}
            className={clsx(
              "size-3 shrink-0 [&_path]:fill-current",
              higher ? "text-fs-tone-success-text" : "text-fs-tone-error-text",
            )}
          />
        ) : null}
      </span>
      <span
        data-testid="estimate-move"
        title={where || undefined}
        className="type-caption text-fs-text-secondary min-w-0 truncate tabular-nums [grid-area:2/2/3/4] sm:[grid-area:auto]"
      >
        {where}
      </span>
      {hasRemove ? (
        <LightButton
          className={clsx(
            "relative size-7 justify-center justify-self-end p-0 [grid-area:1/4/3/5] sm:[grid-area:auto]",
            "hover:bg-transparent [@media(pointer:fine)]:hover:bg-fs-surface-tint",
            "before:absolute before:-inset-x-2 before:-inset-y-1 before:content-[''] sm:before:-inset-y-0.5",
            "disabled:opacity-50",
          )}
          text=""
          aria-label={`Remove ${scale.name}`}
          icon={<CloseIcon className="text-fs-text-secondary size-3" />}
          isDisabled={isReadOnly || !onRemove}
          onPress={onRemove}
        />
      ) : null}
    </li>
  );
}

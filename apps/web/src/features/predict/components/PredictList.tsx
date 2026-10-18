import { useEffect, useRef, useState } from "react";

import clsx from "clsx";

import LightButton from "@/components/ui/LightButton";

import CloseIcon from "@/assets/svg/close.svg";
import ArrowDown from "@/assets/svg/long-arrow-down.svg";
import ArrowUp from "@/assets/svg/long-arrow-up.svg";

import { formatEstimate } from "@/utils/formatEstimate";

import type { SelectedEstimate } from "../types";
import type { PreviewTrades } from "../utils/plan";

/** An estimate as the list shows it; a stored run's has no market estimate to compare against. */
export type ListedEstimate = Pick<SelectedEstimate, "scale" | "value"> &
  Partial<Pick<SelectedEstimate, "direction" | "marketEstimate">>;

/** An option's market estimate before and after the prediction, in the option's unit. */
export interface PriceMove {
  from: number;
  to: number;
  /** The trades that make the move, in the collateral's base units. */
  plan?: Omit<PreviewTrades, "from" | "to">;
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
}: {
  selected: ListedEstimate[];
  onRemove: (market: string) => void;
  isReadOnly: boolean;
  /** A stored run's estimates, which offer no remove at all. */
  isFixed?: boolean;
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
        isFixed || selected.length < 2
          ? "grid-cols-[8px_minmax(0,1fr)_max-content]"
          : "grid-cols-[8px_minmax(0,1fr)_max-content_28px]",
      )}
    >
      {selected.map((estimate) => (
        <EstimateRow
          key={estimate.scale.market}
          estimate={estimate}
          onRemove={removable ? () => remove(estimate.scale.market) : undefined}
          hasRemove={selected.length > 1 && !isFixed}
          isLeaving={leaving.includes(estimate.scale.market)}
          isReadOnly={isReadOnly}
        />
      ))}
    </ul>
  );
}

function EstimateRow({
  estimate,
  onRemove,
  hasRemove,
  isLeaving,
  isReadOnly,
}: {
  estimate: ListedEstimate;
  onRemove?: () => void;
  hasRemove: boolean;
  isLeaving: boolean;
  isReadOnly: boolean;
}) {
  const { scale } = estimate;
  const higher = estimate.direction === "higher";
  const Arrow = higher ? ArrowUp : ArrowDown;

  return (
    <li
      data-leaving={isLeaving || undefined}
      className={clsx(
        "col-span-full grid h-8 grid-cols-subgrid items-center text-[15px] leading-5",
        // folds its fixed 32px as it fades, so what sits below rises with it; a known height needs no measuring
        "transition-[opacity,scale,height] duration-(--fs-dur-echo) ease-(--fs-ease-exit)",
        "data-leaving:h-0 data-leaving:overflow-hidden data-leaving:scale-[.97] data-leaving:opacity-0",
        "motion-reduce:data-leaving:scale-100",
      )}
    >
      <span className="size-2 rounded-full" style={{ backgroundColor: scale.color }} aria-hidden />
      <span className="text-fs-popup-text min-w-0 truncate font-medium" title={scale.name}>
        {scale.name}
      </span>
      <span className="text-fs-popup-text inline-flex items-center gap-1.5 justify-self-end font-medium whitespace-nowrap tabular-nums">
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
      {hasRemove ? (
        <LightButton
          className={clsx(
            "relative size-7 justify-center justify-self-end rounded-full! p-0",
            "hover:bg-transparent [@media(pointer:fine)]:hover:bg-fs-popup-chip",
            // a 44px-wide target; the row's own 32px is its height
            "before:absolute before:-inset-x-2 before:-inset-y-0.5 before:content-['']",
            "disabled:opacity-50",
            // the list's scroll area clips at its sides, so the ring sits inside the edge
            "[--fs-focus-offset:-2px]",
          )}
          text=""
          aria-label={`Remove ${scale.name}`}
          icon={<CloseIcon className="text-fs-popup-text-3 size-3" />}
          isDisabled={isReadOnly || !onRemove}
          onPress={onRemove}
        />
      ) : null}
    </li>
  );
}

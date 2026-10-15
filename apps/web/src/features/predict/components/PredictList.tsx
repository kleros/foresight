import clsx from "clsx";

import LightButton from "@/components/ui/LightButton";
import { ScrollFade } from "@/components/ui/ScrollFade";

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

/** The popup's title and the estimates going into it, one line each, removable while more than one is left. */
export function PredictList({
  selected,
  onRemove,
  isReadOnly,
  preview = {},
}: {
  selected: ListedEstimate[];
  onRemove: (market: string) => void;
  isReadOnly: boolean;
  /** Keyed by lower-case market; an option without an entry shows where its market is now. */
  preview?: Record<string, PriceMove>;
}) {
  return (
    <div className="mb-4 flex w-full shrink-0 flex-col gap-3 short:mb-2 short:gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-fs-text-primary text-xl font-semibold md:text-2xl">Predict</h2>
        <span className="type-label text-fs-text-secondary">
          {selected.length} {selected.length === 1 ? "estimate" : "estimates"}
        </span>
      </div>
      {/* three rows before it scrolls */}
      <ScrollFade className="max-h-[calc(3*var(--estimate-row)+2*0.25rem)] w-full [--estimate-row:4rem] sm:[--estimate-row:5.5rem] short:[--estimate-row:3rem]">
        <ul className="flex w-full flex-col gap-1">
          {selected.map((estimate) => (
            <EstimateRow
              key={estimate.scale.market}
              estimate={estimate}
              move={preview[estimate.scale.market.toLowerCase()]}
              onRemove={selected.length > 1 ? () => onRemove(estimate.scale.market) : undefined}
              isReadOnly={isReadOnly}
            />
          ))}
        </ul>
      </ScrollFade>
    </div>
  );
}

function EstimateRow({
  estimate,
  move,
  onRemove,
  isReadOnly,
}: {
  estimate: ListedEstimate;
  move: PriceMove | undefined;
  onRemove?: () => void;
  isReadOnly: boolean;
}) {
  const { scale } = estimate;
  const higher = estimate.direction === "higher";
  const Arrow = higher ? ArrowUp : ArrowDown;
  const format = (value: number) => formatEstimate(value, scale.unit);
  // a move that rounds to nothing would read "from 51.22 % to 51.22 %"
  const moved = move && format(move.from) !== format(move.to) ? move : undefined;
  const where = moved
    ? `Market moves from ${format(moved.from)} to ${format(moved.to)}`
    : estimate.marketEstimate !== undefined
      ? `Market at ${format(estimate.marketEstimate)}`
      : "";

  return (
    <li
      className={clsx(
        "bg-fs-surface-tint rounded-fs relative h-(--estimate-row) w-full px-9",
        "flex flex-col items-center justify-center text-center",
      )}
    >
      <div className="flex max-w-full min-w-0 items-center gap-2 text-sm leading-5 sm:text-base sm:leading-6 short:text-sm short:leading-4">
        <span className="size-2 flex-none rounded-full" style={{ backgroundColor: scale.color }} aria-hidden />
        <span className="text-fs-text-primary min-w-0 truncate font-semibold" title={scale.name}>
          {scale.name}
        </span>
        <span className="text-fs-text-primary shrink-0 whitespace-nowrap">
          Estimate <span className="font-semibold tabular-nums">{format(estimate.value)}</span>
        </span>
      </div>
      <span
        className={clsx(
          "min-h-4 text-xs leading-4 sm:min-h-5 sm:text-sm sm:leading-5 short:min-h-4 short:text-xs short:leading-4",
          higher ? "text-fs-tone-success-text" : "text-fs-tone-error-text",
        )}
      >
        {estimate.direction ? (
          <>
            <Arrow
              role="img"
              aria-label={higher ? "above the market" : "below the market"}
              className="mr-1 inline size-3 [&_path]:fill-current"
            />
            {higher ? "Higher" : "Lower"} than the market
          </>
        ) : null}
      </span>
      <span
        data-testid="estimate-move"
        title={where || undefined}
        className="text-fs-text-secondary min-h-4 max-w-full truncate text-xs leading-4 tabular-nums sm:min-h-5 sm:text-sm sm:leading-5 short:min-h-4 short:text-xs short:leading-4"
      >
        {where}
      </span>
      {onRemove ? (
        <LightButton
          className="hover:bg-fs-surface absolute top-1/2 right-1 size-7 -translate-y-1/2 justify-center p-0 before:absolute before:-inset-x-2 before:-inset-y-1 before:content-['']"
          text=""
          aria-label={`Remove ${scale.name}`}
          icon={<CloseIcon className="text-fs-text-secondary size-3" />}
          isDisabled={isReadOnly}
          onPress={onRemove}
        />
      ) : null}
    </li>
  );
}

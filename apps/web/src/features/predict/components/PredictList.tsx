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
    <div className="mb-4 flex w-full shrink-0 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-fs-text-primary text-xl font-semibold md:text-2xl">Predict</h2>
        <span className="type-label text-fs-text-secondary">
          {selected.length} {selected.length === 1 ? "estimate" : "estimates"}
        </span>
      </div>
      {/* five rows before it scrolls */}
      <ScrollFade className="max-h-[196px] w-full">
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
  // a move that rounds to nothing would read "51.22 % → 51.22 %"
  const moved = move && format(move.from) !== format(move.to) ? move : undefined;
  const where = moved ? (
    format(moved.to) === format(estimate.value) ? (
      <>
        {/* a destination equal to the estimate repeats it, so a phone names the origin instead */}
        <span className="max-sm:hidden">
          {formatEstimate(moved.from, null)} → {format(moved.to)}
        </span>
        <span className="sm:hidden">from {format(moved.from)}</span>
      </>
    ) : (
      <>
        {/* a phone keeps the destination, the one figure the preview adds */}
        <span className="max-sm:hidden">{formatEstimate(moved.from, null)} </span>→ {format(moved.to)}
      </>
    )
  ) : estimate.marketEstimate !== undefined ? (
    `from ${format(estimate.marketEstimate)}`
  ) : undefined;

  return (
    <li className="bg-fs-surface-tint rounded-fs type-label flex h-9 w-full items-center gap-2.5 pr-1 pl-3">
      <span className="size-2 flex-none rounded-full" style={{ backgroundColor: scale.color }} aria-hidden />
      <span className="text-fs-text-primary min-w-0 truncate font-semibold" title={scale.name}>
        {scale.name}
      </span>
      <span className="text-fs-text-primary shrink-0 font-semibold tabular-nums">{format(estimate.value)}</span>
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
      {where ? (
        <span data-testid="estimate-move" className="text-fs-text-secondary shrink-0 whitespace-nowrap tabular-nums">
          {where}
        </span>
      ) : null}
      {onRemove ? (
        <LightButton
          className="hover:bg-fs-surface relative ml-auto size-7 shrink-0 justify-center p-0 before:absolute before:-inset-x-2 before:-inset-y-1 before:content-['']"
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

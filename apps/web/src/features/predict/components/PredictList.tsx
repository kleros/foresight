import clsx from "clsx";

import LightButton from "@/components/ui/LightButton";
import { ScrollFade } from "@/components/ui/ScrollFade";

import CloseIcon from "@/assets/svg/close.svg";
import ArrowDown from "@/assets/svg/long-arrow-down.svg";
import ArrowUp from "@/assets/svg/long-arrow-up.svg";

import { formatEstimate } from "@/utils/formatEstimate";

import type { SelectedEstimate } from "../types";

/** An estimate as the list shows it; a stored run's has no market estimate to compare against. */
export type ListedEstimate = Pick<SelectedEstimate, "scale" | "value"> & Partial<Pick<SelectedEstimate, "direction">>;

/** An option's market estimate before and after the prediction, in the option's unit. */
export interface PriceMove {
  from: number;
  to: number;
}

/** The popup's title and the estimates going into it, each removable while more than one is left. */
export function PredictList({
  selected,
  onRemove,
  isReadOnly,
  preview = {},
}: {
  selected: ListedEstimate[];
  onRemove: (market: string) => void;
  isReadOnly: boolean;
  /** Keyed by lower-case market; an option without an entry shows no move. */
  preview?: Record<string, PriceMove>;
}) {
  return (
    <div className="mb-1 flex min-h-28 w-full shrink grow-0 flex-col items-center gap-2 md:mb-4 md:gap-4">
      <h2 className="text-fs-text-primary shrink-0 text-xl font-semibold md:text-2xl">Predict</h2>
      <ScrollFade className="rounded-fs max-h-35 min-h-18 md:max-h-40 w-full shrink">
        <ul className="flex w-full flex-col gap-0.25">
          {selected.map((estimate) => {
            const higher = estimate.direction === "higher";
            const Arrow = higher ? ArrowUp : ArrowDown;
            const priced = preview[estimate.scale.market.toLowerCase()];
            // a move that rounds to nothing would read "from 51.22 % to 51.22 %"
            const move =
              priced &&
              formatEstimate(priced.from, estimate.scale.unit) !== formatEstimate(priced.to, estimate.scale.unit)
                ? priced
                : undefined;
            return (
              <li
                key={estimate.scale.market}
                className={clsx(
                  "bg-fs-surface-tint rounded-fs relative w-full",
                  "flex flex-col items-center justify-center py-1.5 md:p-3",
                )}
              >
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2 flex-none rounded-full"
                      style={{ backgroundColor: estimate.scale.color }}
                      aria-hidden
                    />
                    <span className="text-fs-text-primary text-sm font-semibold sm:text-base">
                      {estimate.scale.name}
                    </span>
                  </div>
                  <div className="space-x-2">
                    <span className="text-fs-text-primary text-sm sm:text-base">Estimate</span>
                    <span className="text-fs-text-primary text-sm font-semibold sm:text-base">
                      {formatEstimate(estimate.value, estimate.scale.unit)}
                    </span>
                  </div>
                </div>
                {estimate.direction ? (
                  <span className={clsx("text-xs sm:text-sm", higher ? "text-fs-tone-success" : "text-fs-tone-error")}>
                    <Arrow className="mr-1 inline size-3 [&_path]:fill-current" aria-hidden />
                    {higher ? "Higher" : "Lower"} than the market
                  </span>
                ) : null}
                {move ? (
                  <span className="text-fs-text-secondary text-xs sm:text-sm">
                    Market moves from {formatEstimate(move.from, estimate.scale.unit)} to{" "}
                    {formatEstimate(move.to, estimate.scale.unit)}
                  </span>
                ) : null}
                {selected.length > 1 ? (
                  <LightButton
                    className="absolute top-1/2 right-2 -translate-y-1/2 p-1"
                    text=""
                    aria-label={`Remove ${estimate.scale.name}`}
                    icon={<CloseIcon className="text-fs-text-secondary size-3" />}
                    isDisabled={isReadOnly}
                    onPress={() => onRemove(estimate.scale.market)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      </ScrollFade>
    </div>
  );
}

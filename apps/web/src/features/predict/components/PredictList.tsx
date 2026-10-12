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

/** The popup's title and the estimates going into it, each removable while more than one is left. */
export function PredictList({
  selected,
  onRemove,
  isReadOnly,
}: {
  selected: ListedEstimate[];
  onRemove: (market: string) => void;
  isReadOnly: boolean;
}) {
  return (
    <div className="mb-4 flex min-h-28 w-full shrink grow-0 flex-col items-center gap-4">
      <h2 className="text-fs-text-primary shrink-0 text-2xl font-semibold">Predict</h2>
      <ScrollFade className="rounded-fs max-h-40 min-h-18 w-full shrink">
        <ul className="flex w-full flex-col gap-0.25">
          {selected.map((estimate) => {
            const higher = estimate.direction === "higher";
            const Arrow = higher ? ArrowUp : ArrowDown;
            return (
              <li
                key={estimate.scale.market}
                className={clsx(
                  "bg-fs-surface-tint rounded-fs relative w-full",
                  "flex flex-col items-center justify-center p-3",
                )}
              >
                <div className="flex flex-col items-center gap-2 sm:flex-row">
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

import clsx from "clsx";

import WithHelpTooltip from "@/components/ui/WithHelpTooltip";

import ArrowDown from "@/assets/svg/long-arrow-down.svg";
import ArrowUp from "@/assets/svg/long-arrow-up.svg";

import { formatDisplayAmount } from "@/utils/amount";
import { formatEstimate } from "@/utils/formatEstimate";

import type { OptionScale } from "@/types/optionScale";

import type { SelectedEstimate } from "../types";
import { POSITION_DIGITS, positionLeaning, positionWorth, type OptionPosition } from "../utils/position";

/** What the trade wallet holds of one option, once a prediction has been placed on it. */
export function PositionRow({
  scale,
  position,
  marketEstimate,
  decimals,
  estimate,
}: {
  scale: Pick<OptionScale, "name" | "unit" | "lowerBound" | "upperBound">;
  position: OptionPosition;
  /** Undefined while the market is unknown, which leaves the value out. */
  marketEstimate: number | undefined;
  /** Outcome tokens count in the collateral's base units. */
  decimals: number;
  /** The estimate set on the slider above, if one is. */
  estimate?: Pick<SelectedEstimate, "value" | "direction">;
}) {
  const leaning = positionLeaning(position);
  const amount = (value: bigint) => formatDisplayAmount(value, decimals, POSITION_DIGITS);
  const side = leaning === "higher" ? "UP" : "DOWN";

  return (
    <section aria-label="Your position" className="border-fs-border type-label flex flex-col gap-1 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <span data-testid="position-held" className="whitespace-nowrap tabular-nums">
          <span className="text-fs-tone-success-text">{`${amount(position.up)} UP`}</span>
          <span className="text-fs-text-secondary">{" · "}</span>
          <span className="text-fs-tone-error-text">{`${amount(position.down)} DOWN`}</span>
        </span>
        {marketEstimate !== undefined ? (
          <WithHelpTooltip
            label="How this is worked out"
            tooltipMsg={`What UP and DOWN would pay at today's market, in ${scale.name} tokens (made from sDAI). Not a sale price.`}
          >
            <span className="text-fs-text-primary tabular-nums">
              {`≈ ${amount(positionWorth(position, marketEstimate, scale))} ${scale.name} tokens`}
            </span>
          </WithHelpTooltip>
        ) : null}
      </div>
      {/* held empty without an estimate, so the card keeps one height as the slider crosses the market */}
      {leaning ? (
        <p
          data-testid="position-consequence"
          className={clsx(
            "inline-flex min-h-5 items-center gap-1",
            estimate?.direction === "higher" ? "text-fs-tone-success-text" : "text-fs-tone-error-text",
          )}
        >
          {estimate ? (
            <>
              {estimate.direction === "higher" ? (
                <ArrowUp className="size-3 shrink-0 [&_path]:fill-current" aria-hidden />
              ) : (
                <ArrowDown className="size-3 shrink-0 [&_path]:fill-current" aria-hidden />
              )}
              {estimate.direction === leaning
                ? `${formatEstimate(estimate.value, scale.unit)} adds to ${side}`
                : `${formatEstimate(estimate.value, scale.unit)} sells some ${side}`}
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

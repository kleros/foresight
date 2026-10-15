import clsx from "clsx";

import WithHelpTooltip from "@/components/ui/WithHelpTooltip";

import ArrowDown from "@/assets/svg/long-arrow-down.svg";
import ArrowUp from "@/assets/svg/long-arrow-up.svg";

import { formatAmount } from "@/utils/amount";
import { formatEstimate } from "@/utils/formatEstimate";

import type { OptionScale } from "@/types/optionScale";

import type { SelectedEstimate } from "../types";
import { POSITION_DIGITS, positionLeaning, positionWorth, type OptionPosition } from "../utils/position";

const WORTH_HELP =
  "Each UP pays out more the higher this option resolves, each DOWN the lower, in this option's " +
  "tokens, which the trade wallet mints from sDAI. No pool price is used.";

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
  const Arrow = leaning === "higher" ? ArrowUp : ArrowDown;
  const amount = (value: bigint) => formatAmount(value, decimals, POSITION_DIGITS);
  const side = leaning === "higher" ? "UP" : "DOWN";

  return (
    <section
      aria-label="Your position"
      className="border-fs-border type-label flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3"
    >
      <span className="text-fs-text-secondary">Your position</span>
      <span className="text-fs-text-primary font-semibold tabular-nums">
        {`${amount(position.up)} UP · ${amount(position.down)} DOWN`}
      </span>
      {leaning ? (
        <span
          className={clsx(
            "inline-flex items-center gap-1",
            leaning === "higher" ? "text-fs-tone-success-text" : "text-fs-tone-error-text",
          )}
        >
          <Arrow className="size-3 shrink-0 [&_path]:fill-current" aria-hidden />
          {leaning === "higher" ? "Leaning higher" : "Leaning lower"}
        </span>
      ) : null}
      {marketEstimate !== undefined ? (
        <WithHelpTooltip label="How the worth is worked out" tooltipMsg={WORTH_HELP}>
          <span className="text-fs-text-primary tabular-nums">
            {`Worth ≈ ${amount(positionWorth(position, marketEstimate, scale))} ${scale.name} tokens if it resolved at today's ${formatEstimate(marketEstimate, scale.unit)}`}
          </span>
        </WithHelpTooltip>
      ) : null}
      {leaning && estimate ? (
        <p className="text-fs-text-secondary w-full">
          {`Predicting ${formatEstimate(estimate.value, scale.unit)} ${estimate.direction === leaning ? "adds to" : "sells some of"} your ${side}.`}
        </p>
      ) : null}
    </section>
  );
}

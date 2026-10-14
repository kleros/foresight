import clsx from "clsx";

import WithHelpTooltip from "@/components/ui/WithHelpTooltip";

import ArrowDown from "@/assets/svg/long-arrow-down.svg";
import ArrowUp from "@/assets/svg/long-arrow-up.svg";

import { formatAmount } from "@/utils/amount";

import type { OptionScale } from "@/types/optionScale";

import { positionLeaning, positionWorth, type OptionPosition } from "../utils/position";

const SHOWN_DIGITS = 2;

const WORTH_HELP =
  "Each UP pays out more the higher this option resolves, each DOWN the lower. " +
  "This is what yours would pay if it resolved at today's market estimate.";

/** What the trade wallet holds of one option, once a prediction has been placed on it. */
export function PositionRow({
  scale,
  position,
  marketEstimate,
  decimals,
}: {
  scale: Pick<OptionScale, "name" | "lowerBound" | "upperBound">;
  position: OptionPosition;
  /** Undefined while the market is unknown, which leaves the value out. */
  marketEstimate: number | undefined;
  /** Outcome tokens count in the collateral's base units. */
  decimals: number;
}) {
  const leaning = positionLeaning(position);
  const Arrow = leaning === "higher" ? ArrowUp : ArrowDown;
  const amount = (value: bigint) => formatAmount(value, decimals, SHOWN_DIGITS);

  return (
    <section
      aria-label="Your position"
      className="border-fs-border type-label flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3"
    >
      <span className="text-fs-text-secondary">Your position</span>
      <span className="text-fs-text-primary font-semibold tabular-nums">
        {`${amount(position.up)} UP · ${amount(position.down)} DOWN`}
      </span>
      {marketEstimate !== undefined ? (
        <WithHelpTooltip tooltipMsg={WORTH_HELP}>
          <span className="text-fs-text-primary tabular-nums">
            {`≈ ${amount(positionWorth(position, marketEstimate, scale))} ${scale.name} tokens at the market estimate`}
          </span>
        </WithHelpTooltip>
      ) : null}
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
    </section>
  );
}

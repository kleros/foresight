import clsx from "clsx";

import WithHelpTooltip from "@/components/ui/WithHelpTooltip";

import ArrowDown from "@/assets/svg/long-arrow-down.svg";
import ArrowUp from "@/assets/svg/long-arrow-up.svg";

import { formatDisplayAmount } from "@/utils/amount";
import { formatEstimate } from "@/utils/formatEstimate";

import type { OptionScale } from "@/types/optionScale";

import type { SelectedEstimate } from "../types";
import { POSITION_DIGITS, positionLeaning, positionWorth, type OptionPosition } from "../utils/position";

/** The least share of the bar a side that is held draws, so it never disappears. */
const MIN_SHARE = 0.02;

/** UP's share of the tokens held, 0 to 1, with each side that is held kept at MIN_SHARE or more. */
function upShare(position: OptionPosition): number {
  const total = position.up + position.down;
  if (total === 0n) return 0.5;
  const share = Number((position.up * 10_000n) / total) / 10_000;
  if (position.up > 0n && share < MIN_SHARE) return MIN_SHARE;
  if (position.down > 0n && share > 1 - MIN_SHARE) return 1 - MIN_SHARE;
  return share;
}

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
  const up = upShare(position);

  return (
    <section aria-label="Your position" className="border-fs-border type-label flex flex-col gap-1.5 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <span className="text-fs-text-secondary">Your position</span>
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
      <div className="relative h-1.5 w-full overflow-hidden rounded-full" aria-hidden>
        {(["up", "down"] as const).map((bar) => (
          <span
            key={bar}
            data-testid={`position-bar-${bar}`}
            className={clsx(
              "absolute inset-0 block",
              "transition-transform duration-(--fs-dur-enter) ease-(--fs-ease-enter)",
              bar === "up" ? "bg-fs-estimate-up origin-left" : "bg-fs-estimate-down origin-right",
            )}
            style={{ transform: `scaleX(${bar === "up" ? up : Number((1 - up).toFixed(4))})` }}
          />
        ))}
      </div>
      <div className="flex justify-between gap-4 tabular-nums">
        <span className="text-fs-tone-success-text">{`${amount(position.up)} UP`}</span>
        <span className="text-fs-tone-error-text">{`${amount(position.down)} DOWN`}</span>
      </div>
      {leaning && estimate ? (
        <p
          className={clsx(
            "inline-flex items-center gap-1",
            estimate.direction === "higher" ? "text-fs-tone-success-text" : "text-fs-tone-error-text",
          )}
        >
          {estimate.direction === "higher" ? (
            <ArrowUp className="size-3 shrink-0 [&_path]:fill-current" aria-hidden />
          ) : (
            <ArrowDown className="size-3 shrink-0 [&_path]:fill-current" aria-hidden />
          )}
          {estimate.direction === leaning
            ? `${formatEstimate(estimate.value, scale.unit)} adds to your ${side}`
            : `${formatEstimate(estimate.value, scale.unit)} sells some ${side}`}
        </p>
      ) : null}
    </section>
  );
}

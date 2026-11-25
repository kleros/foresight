import clsx from "clsx";

import { formatDisplayAmount } from "@/utils/amount";

/** sDAI base units as a signed amount, cut toward zero to two places. */
export function signedSdai(value: bigint): string {
  const sign = value > 0n ? "+" : value < 0n ? "-" : "";
  const [whole = "0", fraction = ""] = formatDisplayAmount(value < 0n ? -value : value, 18, 2).split(".");
  return `${sign}${whole}.${fraction.padEnd(2, "0")} sDAI`;
}

const toneOf = (value: bigint) =>
  value > 0n ? "text-fs-tone-success-text" : value < 0n ? "text-fs-tone-error-text" : "text-fs-text-primary";

/** A realised P&L in sDAI base units, beside its label. */
export function PnlFigure({ value }: { value: bigint }) {
  return (
    <span className="inline-flex shrink-0 items-baseline gap-1.5 text-sm whitespace-nowrap">
      <span className="text-fs-text-secondary">P&L:</span>
      <span className={clsx("font-semibold tabular-nums", toneOf(value))}>{signedSdai(value)}</span>
    </span>
  );
}

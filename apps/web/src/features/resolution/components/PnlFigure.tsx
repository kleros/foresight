import clsx from "clsx";

import { formatDisplayAmount } from "@/utils/amount";

const CENT = 10n ** 16n;

/** sDAI base units cut toward zero to whole cents: `1,234.50 sDAI`. */
export function shownSdai(value: bigint): string {
  const [whole = "0", fraction = ""] = formatDisplayAmount(value - (value % CENT), 18, 2).split(".");
  return `${whole}.${fraction.padEnd(2, "0")} sDAI`;
}

type Sign = -1 | 0 | 1;

/** The sign the shown cents carry, so an amount under a cent reads as an unsigned 0.00. */
const signOf = (value: bigint): Sign => (value >= CENT ? 1 : value <= -CENT ? -1 : 0);

/** sDAI base units as a signed amount, cut toward zero to two places. */
export function signedSdai(value: bigint): string {
  const sign = signOf(value);
  return `${sign > 0 ? "+" : sign < 0 ? "-" : ""}${shownSdai(value < 0n ? -value : value)}`;
}

const TONE: Record<Sign, string> = {
  1: "text-fs-tone-success-text",
  0: "text-fs-text-primary",
  [-1]: "text-fs-tone-error-text",
};

/** A realised P&L in sDAI base units, beside its label. */
export function PnlFigure({ value }: { value: bigint }) {
  return (
    <span className="inline-flex shrink-0 items-baseline gap-1.5 text-sm whitespace-nowrap">
      <span className="text-fs-text-secondary">P&L:</span>
      <span className={clsx("font-semibold tabular-nums", TONE[signOf(value)])}>{signedSdai(value)}</span>
    </span>
  );
}

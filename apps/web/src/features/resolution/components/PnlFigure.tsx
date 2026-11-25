import clsx from "clsx";

import ArrowDown from "@/assets/svg/long-arrow-down.svg";
import ArrowUp from "@/assets/svg/long-arrow-up.svg";

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

/** A realised P&L in sDAI base units, beside its label, with an up or down arrow for a gain or a loss. */
export function PnlFigure({ value }: { value: bigint }) {
  const sign = signOf(value);
  const Arrow = sign > 0 ? ArrowUp : sign < 0 ? ArrowDown : null;
  return (
    <span className="inline-flex shrink-0 items-baseline gap-1.5 text-sm whitespace-nowrap">
      <span className="text-fs-text-secondary">P&L:</span>
      <span className={clsx("font-semibold tabular-nums", TONE[sign])}>{signedSdai(value)}</span>
      {Arrow ? (
        <Arrow
          data-arrow={sign > 0 ? "up" : "down"}
          aria-hidden
          className={clsx("size-3 shrink-0 self-center [&_path]:fill-current", TONE[sign])}
        />
      ) : null}
    </span>
  );
}

/** sDAI base units. */
export type PnlFigures = { cost: bigint; payout: bigint; pnl: bigint };

/** What a screen reader hears for a P&L flow: `Put in 2.00 sDAI, back 3.23 sDAI, profit 1.23 sDAI`. */
export function pnlSentence({ cost, payout, pnl }: PnlFigures): string {
  const sign = signOf(pnl);
  const result = sign > 0 ? `profit ${shownSdai(pnl)}` : sign < 0 ? `loss ${shownSdai(-pnl)}` : "no profit or loss";
  return `Put in ${shownSdai(cost)}, back ${shownSdai(payout)}, ${result}`;
}

/** What went in and what came back (spec D21), then the signed P&L; read to screen readers as one sentence. */
export function PnlFlow(figures: PnlFigures) {
  return (
    <span className="min-w-0 text-sm">
      <span className="sr-only">{pnlSentence(figures)}</span>
      <span aria-hidden className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="text-fs-text-secondary whitespace-nowrap tabular-nums">
          {shownSdai(figures.cost)}
          <span className="px-1">→</span>
          {shownSdai(figures.payout)}
        </span>
        <PnlFigure value={figures.pnl} />
      </span>
    </span>
  );
}

import { useId } from "react";

import clsx from "clsx";

import { ChevronIcon } from "@/components/ui/ChevronIcon";

import { formatEstimate } from "@/utils/formatEstimate";
import { INERT } from "@/utils/inert";

import type { ListedEstimate, PriceMove } from "./PredictList";

/** Where an estimate's market goes: `250 → 280 $M`, `Stays at 250 $M`, or `Now 250 $M` before a preview is read. */
export function marketMove(estimate: ListedEstimate, move: PriceMove | undefined): string {
  const format = (value: number) => formatEstimate(value, estimate.scale.unit);
  if (move && format(move.from) !== format(move.to)) return `${formatEstimate(move.from, null)} → ${format(move.to)}`;
  if (move) return `Stays at ${format(move.from)}`;
  return estimate.marketEstimate !== undefined ? `Now ${format(estimate.marketEstimate)}` : "No preview";
}

function headline(selected: ListedEstimate[], preview: Record<string, PriceMove>): string {
  const moving = selected.filter((estimate) => {
    const move = preview[estimate.scale.market.toLowerCase()];
    const format = (value: number) => formatEstimate(value, estimate.scale.unit);
    return move !== undefined && format(move.from) !== format(move.to);
  }).length;
  if (moving === 0) return "Market prices";
  return `${moving} ${moving === 1 ? "market moves" : "markets move"}`;
}

/**
 * One line that says how many markets this prediction moves, opening onto where each one goes.
 * Only figures the app computes are listed; open or closed is the visitor's choice, whatever the run does.
 */
export function PredictSummary({
  selected,
  preview = {},
  isOpen,
  onToggle,
  isPricing = false,
}: {
  selected: ListedEstimate[];
  /** Keyed by lower-case market. */
  preview?: Record<string, PriceMove>;
  isOpen: boolean;
  onToggle: () => void;
  /** A run is pricing its routes. */
  isPricing?: boolean;
}) {
  const body = useId();

  return (
    <div data-testid="predict-summary" className="mt-2 short:mt-1">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={body}
        onClick={onToggle}
        className={clsx(
          "relative flex h-9 w-full items-center justify-between gap-3 rounded-fs-control px-1 text-left",
          "type-label text-fs-popup-text-2 cursor-pointer font-medium",
          "transition-colors duration-(--fs-dur-echo) ease-(--fs-ease-enter)",
          "[@media(hover:hover)]:hover:bg-fs-popup-hover",
          "focus-visible:ring-fs-accent focus-visible:ring-2 focus-visible:outline-none",
        )}
      >
        <span className="text-fs-popup-text flex min-w-0 items-center gap-1.5">
          <TrendIcon />
          <span className="truncate tabular-nums">{isPricing ? "Checking prices…" : headline(selected, preview)}</span>
        </span>
        <ChevronIcon className={clsx("fs-chevron size-4 shrink-0", isOpen && "rotate-180")} />
        {isPricing ? (
          <span data-testid="pricing-sweep" aria-hidden className="predict-sweep">
            <i />
          </span>
        ) : null}
      </button>
      {/* mounted while closed, so the toggle's aria-controls always names it; inert keeps its rows out of reach */}
      <div data-open={isOpen || undefined} className="fs-disclosure">
        <div className="min-h-0 overflow-hidden">
          <ul
            id={body}
            aria-hidden={isOpen ? undefined : true}
            {...(isOpen ? {} : INERT)}
            className="mb-1 flex flex-col border-b border-(--fs-popup-line) px-1 pt-1 pb-2"
          >
            {selected.map((estimate) => (
              <li
                key={estimate.scale.market}
                className="type-label flex h-8 items-center justify-between gap-4 text-[13px] leading-[18px]"
              >
                <span className="text-fs-popup-text-2 flex min-w-0 items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: estimate.scale.color }} />
                  <span className="truncate" title={estimate.scale.name}>
                    {estimate.scale.name}
                  </span>
                </span>
                <span
                  data-testid="market-move"
                  className="text-fs-popup-text font-medium whitespace-nowrap tabular-nums"
                >
                  {marketMove(estimate, preview[estimate.scale.market.toLowerCase()])}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function TrendIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden className="size-4 shrink-0">
      <path
        d="M1.5 11.5l4-4 3 3 6-6M10.5 4.5h4v4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

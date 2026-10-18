import { useId, type ReactNode } from "react";

import clsx from "clsx";

import { ChevronIcon } from "@/components/ui/ChevronIcon";

import { formatDisplayAmount } from "@/utils/amount";
import { formatEstimate } from "@/utils/formatEstimate";
import { INERT } from "@/utils/inert";

import type { ListedEstimate, PriceMove } from "./PredictList";
import type { OptionSide } from "../utils/plan";
import { POSITION_DIGITS } from "../utils/position";
import { CHECKING_PRICES } from "../utils/predictSteps";

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

type Plan = NonNullable<PriceMove["plan"]>;

/** Keeps a figure, its `≈` and its unit on one line. */
const nb = (...parts: string[]) => parts.join("\u00a0");

/** A wrapped value keeps its label on its first line. */
const ROW = "flex items-baseline justify-between gap-3";
const VALUE = "text-fs-popup-text min-w-0 text-right [overflow-wrap:anywhere]";

function Arrow() {
  return (
    <>
      {" "}
      <span className="text-fs-popup-text-3">→</span>{" "}
    </>
  );
}

function Side({ side, amount }: { side: OptionSide; amount: string }) {
  const up = side === "up";
  return (
    <span className={clsx("font-medium", up ? "text-fs-tone-success-text" : "text-fs-tone-error-text")}>
      {nb(amount, up ? "UP" : "DOWN")}
    </span>
  );
}

function Leg({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className={clsx(ROW, "py-[3px]")}>
      <span className="text-fs-popup-text-2 shrink-0">{label}</span>
      <span data-testid="trade-leg" className={VALUE}>
        {children}
      </span>
    </li>
  );
}

/** An option's legs in the order the run makes them; a figure the pool maths simulates carries `≈`. */
function TradeLegs({ plan, decimals, name }: { plan: Plan; decimals: number; name: string }) {
  const amount = (value: bigint) => formatDisplayAmount(value, decimals, POSITION_DIGITS);
  // the buys spend what the sells are expected to pay, so they are only as exact as the sells
  const buyIn = (value: bigint) => (plan.sells.length > 0 ? nb("≈", amount(value)) : amount(value));
  const trades = plan.sells.length > 0 || plan.buys.length > 0;

  return (
    <ul
      aria-label={`Trades for ${name}`}
      className="mb-1 ml-[3px] border-l-[1.5px] border-dotted border-(--fs-popup-line-strong) pl-[13px]"
    >
      {!trades ? <Leg label="No trade">Already at your estimate; left out</Leg> : null}
      {plan.split > 0n ? (
        <Leg label="Split">
          {nb(amount(plan.split), "tokens")}
          <Arrow />
          <Side side="up" amount={amount(plan.split)} />
          {" + "}
          <Side side="down" amount={amount(plan.split)} />
        </Leg>
      ) : null}
      {plan.sells.map((sell) => (
        <Leg key={`sell-${sell.side}`} label="Sell">
          <Side side={sell.side} amount={amount(sell.amountIn)} />
          <Arrow />
          {nb("≈", amount(sell.underlyingOut), "tokens")}
        </Leg>
      ))}
      {plan.merge > 0n ? (
        <Leg label="Merge">
          {nb(amount(plan.merge), "pairs")}
          <Arrow />
          {nb(amount(plan.merge), "tokens")}
        </Leg>
      ) : null}
      {plan.buys.map((buy) => (
        <Leg key={`buy-${buy.side}`} label="Buy">
          {nb(buyIn(buy.amountIn), "tokens")}
          <Arrow />
          <Side side={buy.side} amount={nb("≈", amount(buy.outcomeOut))} />
        </Leg>
      ))}
    </ul>
  );
}

/**
 * One line that says how many markets this prediction moves, opening onto where each one goes and the trades
 * that move it. Only figures the app computes are listed; open or closed is the visitor's choice, whatever the run does.
 */
export function PredictSummary({
  selected,
  preview = {},
  collateral,
  mint,
  isOpen,
  onToggle,
  isPricing = false,
}: {
  selected: ListedEstimate[];
  /** Keyed by lower-case market. */
  preview?: Record<string, PriceMove>;
  /** Option tokens count in the collateral's base units too. */
  collateral: { symbol: string; decimals: number };
  /** Collateral split at the parent into a token of every option; `noun` names one option. */
  mint?: { amount: bigint; noun: string };
  isOpen: boolean;
  onToggle: () => void;
  /** A run is pricing its routes. */
  isPricing?: boolean;
}) {
  const body = useId();
  const amount = (value: bigint) => formatDisplayAmount(value, collateral.decimals, POSITION_DIGITS);
  const isPlanned = selected.some((estimate) => preview[estimate.scale.market.toLowerCase()]?.plan !== undefined);

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
          // the body's scroll area clips at its sides, so the ring sits inside the edge
          "[--fs-focus-offset:-2px]",
        )}
      >
        <span className="text-fs-popup-text flex min-w-0 items-center gap-1.5">
          <TrendIcon />
          <span className="truncate tabular-nums">{isPricing ? CHECKING_PRICES : headline(selected, preview)}</span>
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
          <div
            id={body}
            aria-hidden={isOpen ? undefined : true}
            {...(isOpen ? {} : INERT)}
            className="type-label mb-1 flex flex-col border-b border-(--fs-popup-line) px-1 pt-1 pb-2 text-[13px] leading-[18px] tabular-nums"
          >
            {mint && mint.amount > 0n ? (
              <p data-testid="trade-mint" className={clsx(ROW, "py-1.5")}>
                <span className="text-fs-popup-text-2 shrink-0">Mint</span>
                <span className={clsx(VALUE, "font-medium")}>
                  {nb(amount(mint.amount), collateral.symbol)}
                  <Arrow />
                  {nb(amount(mint.amount), "tokens of every", mint.noun)}
                </span>
              </p>
            ) : null}
            <ul aria-label="Markets" className="flex flex-col">
              {selected.map((estimate) => {
                const move = preview[estimate.scale.market.toLowerCase()];
                return (
                  <li key={estimate.scale.market} className="flex flex-col">
                    <div className="flex h-8 items-center justify-between gap-4">
                      <span className="text-fs-popup-text-2 flex min-w-0 items-center gap-2">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: estimate.scale.color }}
                        />
                        <span className="truncate" title={estimate.scale.name}>
                          {estimate.scale.name}
                        </span>
                      </span>
                      <span data-testid="market-move" className="text-fs-popup-text font-medium whitespace-nowrap">
                        {marketMove(estimate, move)}
                      </span>
                    </div>
                    {move?.plan ? (
                      <TradeLegs plan={move.plan} decimals={collateral.decimals} name={estimate.scale.name} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {isPlanned ? (
              <p data-testid="trades-note" className="text-fs-popup-text-3 mt-1 text-xs leading-4 text-pretty">
                Planned from today&apos;s pools. Prices are checked again when you confirm.
              </p>
            ) : null}
          </div>
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

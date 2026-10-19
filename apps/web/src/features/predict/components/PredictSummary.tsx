import { useId, type ReactNode } from "react";

import clsx from "clsx";

import { ChevronIcon } from "@/components/ui/ChevronIcon";

import { formatEstimate } from "@/utils/formatEstimate";
import { INERT } from "@/utils/inert";

import type { ListedEstimate, PriceMove } from "./PredictList";
import type { CreditsSwapPreview } from "../flow/types";
import { DEFAULT_SLIPPAGE } from "../oracle/tolerances";
import { shownAmount } from "../utils/funding";
import type { OptionSide } from "../utils/plan";
import { CHECKING_PRICES } from "../utils/predictSteps";
import { slippagePercent, type SlippageKind, type SlippageSettings } from "../utils/slippage";

/** The credits a run spends and their swap into xDAI as quoted now. */
export interface CreditsSwapShown {
  credits: bigint;
  preview: CreditsSwapPreview;
  /** The swap as shown before the pools moved, when it now pays less. */
  was?: CreditsSwapPreview;
}

/** WXDAI and xDAI, which the credits swap pays, have 18 decimals. */
const XDAI_DECIMALS = 18;

/** Where an estimate's market goes: `250 → 280 $M`, `Stays at 250 $M`, or `Now 250 $M` before a preview is read. */
export function marketMove(estimate: ListedEstimate, move: PriceMove | undefined): string {
  const format = (value: number) => formatEstimate(value, estimate.scale.unit);
  if (move && format(move.from) !== format(move.to)) return `${formatEstimate(move.from, null)} → ${format(move.to)}`;
  if (move) return `Stays at ${format(move.from)}`;
  return estimate.marketEstimate !== undefined ? `Now ${format(estimate.marketEstimate)}` : "No preview";
}

/** An option the run trades, whether or not its shown value moves. */
const isTraded = (move: PriceMove | undefined): boolean =>
  move?.plan !== undefined && (move.plan.sells.length > 0 || move.plan.buys.length > 0);

/** The trades spend all they are sized to with no leg reaching the estimate, and the move ends short of it as shown. */
function stopsShort(estimate: ListedEstimate, move: PriceMove | undefined): boolean {
  if (!move?.plan || !isTraded(move)) return false;
  if ([...move.plan.sells, ...move.plan.buys].some((leg) => leg.toTarget)) return false;
  return formatEstimate(move.to, estimate.scale.unit) !== formatEstimate(estimate.value, estimate.scale.unit);
}

function headline(selected: ListedEstimate[], preview: Record<string, PriceMove>): string {
  const moveOf = (estimate: ListedEstimate) => preview[estimate.scale.market.toLowerCase()];
  const moving = selected.filter((estimate) => {
    const move = moveOf(estimate);
    const format = (value: number) => formatEstimate(value, estimate.scale.unit);
    return move !== undefined && (format(move.from) !== format(move.to) || isTraded(move));
  }).length;
  if (moving === 0) return "Market prices";
  const short = selected.filter((estimate) => stopsShort(estimate, moveOf(estimate))).length;
  const count = `${moving} ${moving === 1 ? "market moves" : "markets move"}`;
  return short > 0 ? `${count} · ${short} ${short === 1 ? "stops" : "stop"} short` : count;
}

type Plan = NonNullable<PriceMove["plan"]>;

/** Keeps a figure, its `≈` and its unit on one line. */
const nb = (...parts: string[]) => parts.join("\u00a0");

/** A figure as the amount field shows it, `≈` first where it is estimated, and its unit, singular for exactly 1. */
function figure(value: bigint, decimals: number, approx: boolean, unit?: [one: string, many: string]): string {
  const shown = shownAmount(value, decimals);
  const parts = approx ? ["≈", shown] : [shown];
  return unit ? nb(...parts, shown === "1" ? unit[0] : unit[1]) : nb(...parts);
}

const TOKENS: [string, string] = ["token", "tokens"];

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

/**
 * An option's legs in the order the run makes them. A figure the pool maths simulates carries `≈`, and with
 * `isEstimated` so does every figure, since the amount going in is itself an estimate.
 */
function TradeLegs({
  plan,
  decimals,
  name,
  isAtEstimate,
  isEstimated,
}: {
  plan: Plan;
  decimals: number;
  name: string;
  /** The market already shows the visitor's estimate. */
  isAtEstimate: boolean;
  isEstimated: boolean;
}) {
  const show = (value: bigint, approx: boolean, unit?: [string, string]) =>
    figure(value, decimals, approx || isEstimated, unit);
  const minted = plan.split - plan.held;
  // the buys spend what the sells are expected to pay, so they are only as exact as the sells
  const sellsPay = plan.sells.length > 0;

  return (
    <ul
      aria-label={`Trades for ${name}`}
      className="mb-1 ml-[3px] border-l border-dotted border-(--fs-popup-line-strong) pl-[13px]"
    >
      {plan.sells.length === 0 && plan.buys.length === 0 ? (
        <Leg label="No trade">
          {isAtEstimate ? "Already at your estimate; left out" : "Too little to move it; left out"}
        </Leg>
      ) : null}
      {plan.split > 0n ? (
        <Leg label="Split">
          {plan.held === 0n
            ? show(plan.split, false, TOKENS)
            : minted > 0n
              ? `${show(minted, false, TOKENS)} + ${figure(plan.held, decimals, false, ["held", "held"])}`
              : figure(plan.held, decimals, false, ["held token", "held tokens"])}
          <Arrow />
          <Side side="up" amount={show(plan.split, false)} />
          {" + "}
          <Side side="down" amount={show(plan.split, false)} />
        </Leg>
      ) : null}
      {plan.sells.map((sell) => (
        <Leg key={`sell-${sell.side}`} label="Sell">
          <Side side={sell.side} amount={show(sell.amountIn, sell.toTarget)} />
          <Arrow />
          {show(sell.underlyingOut, true, TOKENS)}
        </Leg>
      ))}
      {plan.merge > 0n ? (
        <Leg label="Merge">
          {show(plan.merge, false, ["pair", "pairs"])}
          <Arrow />
          {show(plan.merge, false, TOKENS)}
        </Leg>
      ) : null}
      {plan.buys.map((buy) => (
        <Leg key={`buy-${buy.side}`} label="Buy">
          {show(buy.amountIn, sellsPay || buy.toTarget, TOKENS)}
          <Arrow />
          <Side side={buy.side} amount={show(buy.outcomeOut, true)} />
        </Leg>
      ))}
      {plan.feeValue > 0n ? <Leg label="Pool fees">{show(plan.feeValue, true, TOKENS)}</Leg> : null}
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
  isEstimated = false,
  creditsSwap,
  slippage,
  onOpenSettings,
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
  /** The collateral going in is an estimate, as an xDAI payment's is, so every figure from it is too. */
  isEstimated?: boolean;
  /** Credits the run swaps into xDAI, absent where it spends none. */
  creditsSwap?: CreditsSwapShown;
  /** The visitor's settings, each kind the run uses named with its value. */
  slippage?: SlippageSettings;
  /** Opens the settings; absent while they cannot change. */
  onOpenSettings?: () => void;
}) {
  const body = useId();
  const fees = feesTotal(selected, preview);
  // a button in the folded body is one the dialog's focus trap would Tab to and fail to focus
  const openSettings = isOpen ? onOpenSettings : undefined;
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
            className="type-label mb-1 flex flex-col border-b border-(--fs-popup-line) px-1 pt-1 pb-2 tabular-nums"
          >
            {mint && mint.amount > 0n ? (
              <p data-testid="trade-mint" className={clsx(ROW, "py-1.5")}>
                <span className="text-fs-popup-text-2 shrink-0">Mint</span>
                <span className={clsx(VALUE, "font-medium")}>
                  {figure(mint.amount, collateral.decimals, isEstimated, [collateral.symbol, collateral.symbol])}
                  <Arrow />
                  {nb(figure(mint.amount, collateral.decimals, isEstimated, TOKENS), "of every", mint.noun)}
                </span>
              </p>
            ) : null}
            {creditsSwap ? (
              <>
                <p data-testid="credits-swap" className={clsx(ROW, "py-1.5")}>
                  <span className="text-fs-popup-text-2 shrink-0">Credits swap</span>
                  <span className={clsx(VALUE, "font-medium")}>
                    {figure(creditsSwap.credits, collateral.decimals, false, ["credit", "credits"])}
                    <Arrow />
                    {figure(creditsSwap.preview.quoted, XDAI_DECIMALS, true, ["xDAI", "xDAI"])}
                  </span>
                </p>
                {creditsSwap.was ? (
                  <p data-testid="credits-was" className="text-fs-tone-warning-text -mt-1 pb-1.5 pl-4 text-right">
                    {`Before: ${figure(creditsSwap.was.quoted, XDAI_DECIMALS, true, ["xDAI", "xDAI"])}`}
                  </p>
                ) : null}
                {creditsSwap.preview.loss > 0n ? (
                  <p data-testid="credits-loss" className={clsx(ROW, "pb-1.5")}>
                    <span className="text-fs-popup-text-2 shrink-0">Swap loss</span>
                    <span className={VALUE}>
                      {figure(creditsSwap.preview.loss, XDAI_DECIMALS, true, ["xDAI", "xDAI"])}
                    </span>
                  </p>
                ) : null}
              </>
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
                    {move?.was ? (
                      <p data-testid="market-was" className="text-fs-tone-warning-text -mt-1 mb-1 pl-4 text-right">
                        {`Before: ${marketMove(estimate, move.was)}`}
                      </p>
                    ) : null}
                    {stopsShort(estimate, move) ? (
                      <p data-testid="stops-short" className="text-fs-tone-warning-text -mt-1 mb-1 pl-4">
                        Stops short of your estimate
                      </p>
                    ) : null}
                    {move?.plan ? (
                      <TradeLegs
                        plan={move.plan}
                        decimals={collateral.decimals}
                        name={estimate.scale.name}
                        isAtEstimate={
                          formatEstimate(move.from, estimate.scale.unit) ===
                          formatEstimate(estimate.value, estimate.scale.unit)
                        }
                        isEstimated={isEstimated}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {fees !== undefined ? (
              <p data-testid="fees-total" className={clsx(ROW, "py-1")}>
                <span className="text-fs-popup-text-2 shrink-0">Pool fees, all markets</span>
                <span className={VALUE}>{figure(fees, collateral.decimals, true, TOKENS)}</span>
              </p>
            ) : null}
            {slippage ? (
              <SlippageRow kind="tradeBps" label="Max slippage on trades" settings={slippage} onPress={openSettings} />
            ) : null}
            {slippage && creditsSwap ? (
              <SlippageRow
                kind="creditsBps"
                label="Max slippage on the credits swap"
                settings={slippage}
                onPress={openSettings}
              />
            ) : null}
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

/** Every option's pool fees summed, where more than one option pays any. */
function feesTotal(selected: ListedEstimate[], preview: Record<string, PriceMove>): bigint | undefined {
  const fees = selected
    .map((estimate) => preview[estimate.scale.market.toLowerCase()]?.plan?.feeValue ?? 0n)
    .filter((fee) => fee > 0n);
  return fees.length > 1 ? fees.reduce((sum, fee) => sum + fee, 0n) : undefined;
}

/** One kind's max slippage, `1% (Auto)` or the visitor's own; pressed, it opens the settings. */
function SlippageRow({
  kind,
  label,
  settings,
  onPress,
}: {
  kind: SlippageKind;
  label: string;
  settings: SlippageSettings;
  onPress?: () => void;
}) {
  const custom = settings[kind];
  const value = custom === null ? `${slippagePercent(DEFAULT_SLIPPAGE[kind])}% (Auto)` : `${slippagePercent(custom)}%`;
  const content = (
    <>
      <span className="text-fs-popup-text-2 shrink-0">{label}</span>
      <span className={VALUE}>{value}</span>
    </>
  );
  return onPress ? (
    <button
      type="button"
      data-testid="slippage-row"
      onClick={onPress}
      className={clsx(
        ROW,
        "-mx-1 cursor-pointer rounded-fs-control px-1 py-1 text-left",
        "transition-colors duration-(--fs-dur-echo) ease-(--fs-ease-enter) [@media(hover:hover)]:hover:bg-fs-popup-hover",
        "[--fs-focus-offset:-2px]",
      )}
    >
      {content}
    </button>
  ) : (
    <p data-testid="slippage-row" className={clsx(ROW, "py-1")}>
      {content}
    </p>
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

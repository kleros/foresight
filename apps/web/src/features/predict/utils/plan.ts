import type { PoolLiquidity } from "@/types/pool";

import {
  feeOf,
  limitSqrtPriceX96,
  priceFromSqrtPriceX96,
  swapToward,
  volumeUntilPrice,
  type PoolVolumes,
} from "./poolMath";
import { PRICE_TOLERANCE_TICKS } from "../oracle/tolerances";

/**
 * Turning one option's estimate into trades. Splitting the underlying gives an equal amount of
 * both outcome tokens, so a prediction sells the side the market has too high, merges what is
 * left in pairs, and spends the proceeds on the side it has too low.
 */

const WAD = 10n ** 18n;

/** Below a hundredth of a token a leg costs more gas than its price move is worth. */
export const MIN_LEG_WEI = 10n ** 16n;

/** Of ten thousand, held back from the buys beyond what slippage lets a sell fall short by. */
const BUY_BUDGET_MARGIN_BPS = 100n;

/** Of ten thousand, what the buys may spend of the sells' quoted proceeds and the merge. */
export const buyBudgetShareBps = (slippageBps: number): bigint => 10_000n - BigInt(slippageBps) - BUY_BUDGET_MARGIN_BPS;

/**
 * Of ten thousand, added to what a leg is sized to need. Algebra re-derives its fee from volatility
 * on a block's first swap, so it can rise between the read and the swap; the price limit stops
 * the leg at the target and the excess stays in the trade wallet.
 */
export const LEG_HEADROOM_BPS = 100n;

const withHeadroom = (amount: bigint): bigint => (amount * (10_000n + LEG_HEADROOM_BPS)) / 10_000n;

export type OptionSide = "up" | "down";

const SIDES = ["up", "down"] as const;

export interface OutcomeBalances {
  up: bigint;
  down: bigint;
  /** Seer wraps an INVALID outcome past the named ones, and a merge burns the whole set. */
  invalid: bigint;
}

export interface OptionTarget {
  /** Each outcome token's pool against this option's underlying. */
  pools: Record<OptionSide, PoolLiquidity>;
  /** The visitor's estimate as the UP token's price; the clamp on it keeps DOWN off zero too. */
  targetPriceWad: bigint;
  /** What the executor holds before the split. */
  held: OutcomeBalances;
  /** Underlying to split first, which adds the same amount to all three balances. */
  splitAmount: bigint;
}

export interface SwapLeg {
  side: OptionSide;
  /** Outcome tokens for a sell, underlying for a buy. */
  amountIn: bigint;
  /** The pool's sqrt price at this side's target, which the swap may not pass. */
  limitSqrtPrice: bigint;
  /** What the swap spends if it runs all the way to the limit. */
  amountInAtLimit: bigint;
  /** What the swap returns if it runs all the way to the limit. */
  amountOutAtLimit: bigint;
}

export interface SoldLeg extends Pick<SwapLeg, "side" | "amountIn"> {
  /** What selling `amountIn` was quoted to return. */
  underlyingOut: bigint;
}

export interface BuyPlan {
  /** Outcome sets to merge back to underlying. */
  mergeAmount: bigint;
  legs: SwapLeg[];
}

interface SideState {
  /** How far the market has to move to meet the estimate. Positive is a rise, which is a buy. */
  gap: bigint;
  volumes: PoolVolumes;
  limitSqrtPrice: bigint;
  /** The outcome tokens this side will hold once the split lands. */
  held: bigint;
}

const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);

/** Null where the pool never priced, which leaves that side untradeable. */
function sideState(option: OptionTarget, side: OptionSide): SideState | null {
  const pool = option.pools[side];
  if (pool.sqrtPriceX96 <= 0n) return null;

  const target = side === "up" ? option.targetPriceWad : WAD - option.targetPriceWad;
  const current = priceFromSqrtPriceX96(pool.sqrtPriceX96, pool.outcomeIsToken0);

  return {
    gap: target - current,
    volumes: volumeUntilPrice(pool, target),
    limitSqrtPrice: limitSqrtPriceX96(target, pool.outcomeIsToken0, target > current),
    held: option.held[side] + option.splitAmount,
  };
}

/** Every priced side of `option` sits within `PRICE_TOLERANCE_TICKS` of its estimate. */
export function atEstimate(option: Pick<OptionTarget, "pools" | "targetPriceWad">): boolean {
  const ticks = BigInt(PRICE_TOLERANCE_TICKS);
  const [above, below] = [10_001n ** ticks, 10_000n ** ticks];
  const priced = SIDES.filter((side) => option.pools[side].sqrtPriceX96 > 0n);
  return (
    priced.length > 0 &&
    priced.every((side) => {
      const pool = option.pools[side];
      const target = side === "up" ? option.targetPriceWad : WAD - option.targetPriceWad;
      const price = priceFromSqrtPriceX96(pool.sqrtPriceX96, pool.outcomeIsToken0);
      return price * below <= target * above && price * above >= target * below;
    })
  );
}

/** The sides the market holds above the estimate, each sold as far as the balance reaches. */
export function planSells(option: OptionTarget): SwapLeg[] {
  const legs: SwapLeg[] = [];

  for (const side of SIDES) {
    const state = sideState(option, side);
    if (state === null || state.gap >= 0n) continue;

    const amountIn = min(withHeadroom(state.volumes.outcome), state.held);
    if (amountIn >= MIN_LEG_WEI) {
      legs.push({
        side,
        amountIn,
        limitSqrtPrice: state.limitSqrtPrice,
        amountInAtLimit: state.volumes.outcome,
        amountOutAtLimit: state.volumes.underlying,
      });
    }
  }

  return legs;
}

/**
 * What the sells paid for, once they are quoted: the pairs left over merge back to underlying,
 * and the total buys the sides the market holds below the estimate, each weighted by how far it
 * has to travel, with what one side does not need going to the other. `slippageBps` is how far,
 * in hundredths of a percent, a sell may pay under its quote.
 */
export function planBuys(option: OptionTarget, sold: readonly SoldLeg[], slippageBps: number): BuyPlan {
  let proceeds = 0n;
  const soldBySide: Record<OptionSide, bigint> = { up: 0n, down: 0n };
  for (const leg of sold) {
    soldBySide[leg.side] += leg.amountIn;
    proceeds += leg.underlyingOut;
  }

  const remaining = {
    up: option.held.up + option.splitAmount - soldBySide.up,
    down: option.held.down + option.splitAmount - soldBySide.down,
  };
  const mergeAmount = min(min(remaining.up, remaining.down), option.held.invalid + option.splitAmount);
  const budget = ((proceeds + mergeAmount) * buyBudgetShareBps(slippageBps)) / 10_000n;

  const buying = SIDES.map((side) => ({ side, state: sideState(option, side) })).filter(
    (entry): entry is { side: OptionSide; state: SideState } => entry.state !== null && entry.state.gap > 0n,
  );
  const amounts = allot(
    budget,
    buying.map(({ state }) => ({ weight: state.gap, cap: withHeadroom(state.volumes.underlying) })),
  );

  const legs: SwapLeg[] = [];
  for (const [index, { side, state }] of buying.entries()) {
    const amountIn = amounts[index]!;
    if (amountIn >= MIN_LEG_WEI) {
      legs.push({
        side,
        amountIn,
        limitSqrtPrice: state.limitSqrtPrice,
        amountInAtLimit: state.volumes.underlying,
        amountOutAtLimit: state.volumes.outcome,
      });
    }
  }

  // A sell leaves pairs behind, and a pair left unmerged is money sitting in two halves. An
  // option nothing was done to is left alone instead, rather than paying gas to rearrange it.
  return { mergeAmount: legs.length > 0 || sold.length > 0 ? mergeAmount : 0n, legs };
}

/**
 * Shares `budget` by weight, none above its cap; what a capped share leaves goes to the others
 * by weight, until the budget is spent or every share is at its cap.
 */
function allot(budget: bigint, shares: readonly { weight: bigint; cap: bigint }[]): bigint[] {
  const amounts = shares.map(() => 0n);
  let left = budget;
  let open = shares.map((_, index) => index);
  while (left > 0n && open.length > 0) {
    const weight = open.reduce((sum, index) => sum + shares[index]!.weight, 0n);
    const uncapped: number[] = [];
    let given = 0n;
    for (const index of open) {
      const share = (left * shares[index]!.weight) / weight;
      const room = shares[index]!.cap - amounts[index]!;
      const take = min(share, room);
      amounts[index]! += take;
      given += take;
      if (take === share) uncapped.push(index);
    }
    left -= given;
    if (uncapped.length === open.length) break;
    open = uncapped;
  }
  return amounts;
}

/** A leg as the preview shows it. */
interface PreviewLeg {
  side: OptionSide;
  /** What the swap spends: the leg's amount, or less where the pool reaches the target first. */
  amountIn: bigint;
  /** The pool reaches the target before the leg's amount is spent, so `amountIn` is the pool maths' figure. */
  toTarget: boolean;
  /** The pool's fee on `amountIn`: outcome tokens for a sell, underlying for a buy. */
  fee: bigint;
}

/** One option's trades as the pool maths plays them out against the pools as read. */
export interface PreviewTrades {
  /** Underlying split into one of each outcome token. */
  split: bigint;
  sells: (PreviewLeg & { underlyingOut: bigint })[];
  /** Outcome sets merged back to underlying. */
  merge: bigint;
  buys: (PreviewLeg & { outcomeOut: bigint })[];
  /** The UP token's price before and after, as a wad. */
  from: bigint;
  to: bigint;
  /** Every leg's fee in underlying, a sell's valued at what that sell pays per outcome token. */
  feeValue: bigint;
}

/** The leg's headroom stays in the trade wallet when the price limit stops the swap at the target. */
function spent(leg: SwapLeg, pool: PoolLiquidity): PreviewLeg {
  const amountIn = min(leg.amountIn, leg.amountInAtLimit);
  return { side: leg.side, amountIn, toTarget: leg.amountInAtLimit < leg.amountIn, fee: feeOf(pool, amountIn) };
}

/**
 * The trades `planSells` and `planBuys` make for one option, each filled by the pool maths alone, and where they
 * leave the UP price; null where the UP pool never priced. The run quotes the pools as they are when it signs.
 */
export function previewTrades(option: OptionTarget, slippageBps: number): PreviewTrades | null {
  const up = option.pools.up;
  if (up.sqrtPriceX96 <= 0n) return null;

  const target = (side: OptionSide) => (side === "up" ? option.targetPriceWad : WAD - option.targetPriceWad);
  const from = priceFromSqrtPriceX96(up.sqrtPriceX96, up.outcomeIsToken0);
  let to = from;

  const sold = planSells(option).map((leg) => {
    const swap = swapToward(option.pools[leg.side], target(leg.side), leg.amountIn);
    if (leg.side === "up") to = swap.priceWad;
    return { leg, underlyingOut: swap.amountOut };
  });
  // the run sizes the merge and the buys from the legs as planned, headroom included
  const plan = planBuys(
    option,
    sold.map(({ leg, underlyingOut }) => ({ side: leg.side, amountIn: leg.amountIn, underlyingOut })),
    slippageBps,
  );
  const buys = plan.legs.map((leg) => {
    const swap = swapToward(option.pools[leg.side], target(leg.side), leg.amountIn);
    if (leg.side === "up") to = swap.priceWad;
    return { ...spent(leg, option.pools[leg.side]), outcomeOut: swap.amountOut };
  });
  const sells = sold.map(({ leg, underlyingOut }) => ({ ...spent(leg, option.pools[leg.side]), underlyingOut }));
  const feeValue =
    sells.reduce((sum, leg) => sum + (leg.amountIn > 0n ? (leg.fee * leg.underlyingOut) / leg.amountIn : 0n), 0n) +
    buys.reduce((sum, leg) => sum + leg.fee, 0n);

  // an option with no legs is left out of the run, so nothing of it is split either
  const trades = sells.length > 0 || buys.length > 0;
  return { split: trades ? option.splitAmount : 0n, sells, merge: plan.mergeAmount, buys, from, to, feeValue };
}

/** `now` is within `toleranceBps` of `shown`, as a share of `shown`. */
function near(shown: bigint, now: bigint, toleranceBps: number): boolean {
  const off = shown < now ? now - shown : shown - now;
  return off * 10_000n <= shown * BigInt(toleranceBps);
}

const sameShape = (shown: readonly PreviewLeg[], now: readonly PreviewLeg[]) =>
  shown.length === now.length &&
  shown.every((leg, index) => leg.side === now[index]!.side && leg.toTarget === now[index]!.toTarget);

/**
 * Whether the pools as read now give another plan than the one shown: another leg, another side,
 * an estimate reached or missed, or a figure moved by more than `toleranceBps`.
 */
export function planChanged(shown: PreviewTrades, now: PreviewTrades, toleranceBps: number): boolean {
  if (!sameShape(shown.sells, now.sells) || !sameShape(shown.buys, now.buys)) return true;
  const figures = (trades: PreviewTrades) => [
    trades.merge,
    trades.to,
    ...trades.sells.flatMap((leg) => [leg.amountIn, leg.underlyingOut]),
    ...trades.buys.flatMap((leg) => [leg.amountIn, leg.outcomeOut]),
  ];
  const before = figures(shown);
  return figures(now).some((figure, index) => !near(before[index]!, figure, toleranceBps));
}

/** A leg as the run quoted it: what it spends where its limit stops it, and what the quote pays. */
export interface QuotedLeg {
  side: OptionSide;
  amountIn: bigint;
  amountOut: bigint;
}

/** One option's legs as quoted, or as a plan shows them. */
export interface QuotedLegs {
  sells: readonly QuotedLeg[];
  buys: readonly QuotedLeg[];
}

/** `plan`'s legs, each with what it spends and what it pays. */
export const shownLegs = (plan: PreviewTrades): QuotedLegs => ({
  sells: plan.sells.map(({ side, amountIn, underlyingOut }) => ({ side, amountIn, amountOut: underlyingOut })),
  buys: plan.buys.map(({ side, amountIn, outcomeOut }) => ({ side, amountIn, amountOut: outcomeOut })),
});

/** `plan` with each leg's spend and output as `quotes` give them; a leg they do not quote keeps the plan's. */
export function withQuotes(plan: PreviewTrades, quotes: QuotedLegs): PreviewTrades {
  const quoted = (legs: readonly QuotedLeg[], side: OptionSide) => legs.find((leg) => leg.side === side);
  return {
    ...plan,
    sells: plan.sells.map((leg) => {
      const now = quoted(quotes.sells, leg.side);
      return now ? { ...leg, underlyingOut: now.amountOut } : leg;
    }),
    buys: plan.buys.map((leg) => {
      const now = quoted(quotes.buys, leg.side);
      return now ? { ...leg, amountIn: now.amountIn, outcomeOut: now.amountOut } : leg;
    }),
  };
}

/** `now` is more than `toleranceBps` below `shown`, as a share of `shown`. */
const short = (shown: bigint, now: bigint, toleranceBps: number) =>
  now * 10_000n < shown * (10_000n - BigInt(toleranceBps));

/**
 * Whether a live quote pays less than `shown`'s leg on the same side by more than `toleranceBps`, a buy spends less
 * than shown, or a leg shown is not quoted at all. A quoted leg `shown` does not have is left to the pools' check.
 */
export function quotesShort(shown: QuotedLegs, quoted: QuotedLegs, toleranceBps: number): boolean {
  const legShort = (before: QuotedLeg, legs: readonly QuotedLeg[], buy: boolean) => {
    const now = legs.find((each) => each.side === before.side);
    if (now === undefined) return true;
    return (
      short(
        before.amountIn === 0n ? before.amountOut : (before.amountOut * now.amountIn) / before.amountIn,
        now.amountOut,
        toleranceBps,
      ) ||
      (buy && short(before.amountIn, now.amountIn, toleranceBps))
    );
  };
  return (
    shown.sells.some((leg) => legShort(leg, quoted.sells, false)) ||
    shown.buys.some((leg) => legShort(leg, quoted.buys, true))
  );
}

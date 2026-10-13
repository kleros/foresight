import type { PoolLiquidity } from "@/types/pool";

import { limitSqrtPriceX96, priceFromSqrtPriceX96, swapToward, volumeUntilPrice, type PoolVolumes } from "./poolMath";

/**
 * Turning one option's estimate into trades. Splitting the underlying gives an equal amount of
 * both outcome tokens, so a prediction sells the side the market has too high, merges what is
 * left in pairs, and spends the proceeds on the side it has too low.
 */

const WAD = 10n ** 18n;

/** Below a hundredth of a token a leg costs more gas than its price move is worth. */
export const MIN_LEG_WEI = 10n ** 16n;

/** Of ten thousand, held back from the buys beyond what slippage lets a sell fall short by. */
export const BUY_BUDGET_MARGIN_BPS = 100n;

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
 * has to travel. `slippageBps` is how far, in hundredths of a percent, a sell may pay under its quote.
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
  const totalGap = buying.reduce((sum, { state }) => sum + state.gap, 0n);

  const legs: SwapLeg[] = [];
  for (const { side, state } of buying) {
    const share = (budget * state.gap) / totalGap;
    const amountIn = min(withHeadroom(state.volumes.underlying), share);
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
 * The UP token's price now and once the option's sells and buys have run, from the pool maths alone. The
 * run quotes against the pools as they are when it signs, so it can land elsewhere.
 */
export function previewUpPrice(option: OptionTarget, slippageBps: number): { from: bigint; to: bigint } | null {
  const up = option.pools.up;
  if (up.sqrtPriceX96 <= 0n) return null;

  const target = (side: OptionSide) => (side === "up" ? option.targetPriceWad : WAD - option.targetPriceWad);
  const from = priceFromSqrtPriceX96(up.sqrtPriceX96, up.outcomeIsToken0);
  let price = from;

  const sold = planSells(option).map((leg): SoldLeg => {
    const swap = swapToward(option.pools[leg.side], target(leg.side), leg.amountIn);
    if (leg.side === "up") price = swap.priceWad;
    return { side: leg.side, amountIn: leg.amountIn, underlyingOut: swap.amountOut };
  });
  for (const leg of planBuys(option, sold, slippageBps).legs) {
    if (leg.side === "up") price = swapToward(up, option.targetPriceWad, leg.amountIn).priceWad;
  }

  return { from, to: price };
}

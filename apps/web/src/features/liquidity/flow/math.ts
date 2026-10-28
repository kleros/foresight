import { sqrtPriceAtTick } from "@/lib/swap/tickMath";

/**
 * Algebra's full-range liquidity maths, as its NonfungiblePositionManager and pool run it (the Uniswap v3
 * periphery's LiquidityAmounts and SqrtPriceMath). Prices are Q64.96 sqrt prices of token1 per token0.
 */

const Q96 = 2n ** 96n;
export const BPS = 10_000n;
const MAX_TICK = 887272;

const mulDivUp = (a: bigint, b: bigint, d: bigint) => (a * b + d - 1n) / d;

/** Square root rounded down. */
export function isqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}

/** The widest range a pool of `spacing` allows. */
export function fullRange(spacing: number) {
  const tick = MAX_TICK - (MAX_TICK % spacing);
  return { tickLower: -tick, tickUpper: tick, sqrtA: sqrtPriceAtTick(-tick), sqrtB: sqrtPriceAtTick(tick) };
}

/** The pool sqrt price of a child token worth `bps` of the parent outcome it is paired with. */
export const sqrtPriceForBps = (bps: bigint, childIsToken0: boolean) =>
  childIsToken0 ? isqrt((bps * Q96 * Q96) / BPS) : isqrt((Q96 * Q96 * BPS) / bps);

/** `sqrtP` moved by `ticks`, up for a positive count. */
export const movedSqrtPrice = (sqrtP: bigint, ticks: number) => (sqrtP * sqrtPriceAtTick(ticks)) / Q96;

/** Liquidity `amount0` of token0 buys over [sqrtP, sqrtB]. */
export const liquidityForAmount0 = (sqrtP: bigint, sqrtB: bigint, amount0: bigint) =>
  (amount0 * ((sqrtP * sqrtB) / Q96)) / (sqrtB - sqrtP);

/** Liquidity `amount1` of token1 buys over [sqrtA, sqrtP]. */
export const liquidityForAmount1 = (sqrtA: bigint, sqrtP: bigint, amount1: bigint) => (amount1 * Q96) / (sqrtP - sqrtA);

export const amount0Delta = (lower: bigint, upper: bigint, liquidity: bigint, roundUp: boolean) =>
  roundUp
    ? (mulDivUp(liquidity << 96n, upper - lower, upper) + lower - 1n) / lower
    : ((liquidity << 96n) * (upper - lower)) / upper / lower;

export const amount1Delta = (lower: bigint, upper: bigint, liquidity: bigint, roundUp: boolean) =>
  roundUp ? mulDivUp(liquidity, upper - lower, Q96) : (liquidity * (upper - lower)) / Q96;

/** What a mint of `desired0`/`desired1` at `sqrtP`, inside [sqrtA, sqrtB], adds and pulls from the wallet. */
export function mintAt(sqrtP: bigint, sqrtA: bigint, sqrtB: bigint, desired0: bigint, desired1: bigint) {
  const l0 = liquidityForAmount0(sqrtP, sqrtB, desired0);
  const l1 = liquidityForAmount1(sqrtA, sqrtP, desired1);
  const liquidity = l0 < l1 ? l0 : l1;
  return {
    liquidity,
    amount0: amount0Delta(sqrtP, sqrtB, liquidity, true),
    amount1: amount1Delta(sqrtA, sqrtP, liquidity, true),
  };
}

import { sqrtPriceAtTick } from "@/lib/swap/tickMath";

import type { PoolLiquidity } from "@/types/pool";

/**
 * Concentrated-liquidity maths for one child pool. Both sides are 18-decimal tokens — a pool
 * pairs an outcome token with the parent's wrapped outcome — so every amount here is wei.
 */

const Q96 = 2n ** 96n;
const Q192 = Q96 * Q96;
const WAD = 10n ** 18n;

/** Square root rounded down. */
export function isqrt(value: bigint): bigint {
  if (value < 0n) throw new RangeError("isqrt of a negative value");
  if (value < 2n) return value;

  // seeding at 2^ceil(bits/2) keeps Newton to a handful of steps on a 192-bit input
  let previous = 1n << ((BigInt(value.toString(2).length) + 1n) >> 1n);
  let current = (previous + value / previous) >> 1n;
  while (current < previous) {
    previous = current;
    current = (previous + value / previous) >> 1n;
  }
  return previous;
}

/** Underlying per whole outcome token, 1e18-scaled. The indexer stores this same value. */
export function priceFromSqrtPriceX96(sqrtPriceX96: bigint, outcomeIsToken0: boolean): bigint {
  const ratio = sqrtPriceX96 * sqrtPriceX96;
  return outcomeIsToken0 ? (ratio * WAD) / Q192 : (Q192 * WAD) / ratio;
}

export function sqrtPriceX96FromPrice(priceWad: bigint, outcomeIsToken0: boolean): bigint {
  if (priceWad <= 0n) throw new RangeError("a pool price must be above zero");
  return outcomeIsToken0 ? isqrt((priceWad * Q192) / WAD) : isqrt((Q192 * WAD) / priceWad);
}

/** Square root rounded up. */
function isqrtUp(value: bigint): bigint {
  const root = isqrt(value);
  return root * root < value ? root + 1n : root;
}

/**
 * The sqrt price a swap toward `targetPriceWad` is limited to, rounded so the pool can stop there
 * without its price passing the target. A buy raises the outcome's price, a sell lowers it.
 */
export function limitSqrtPriceX96(targetPriceWad: bigint, outcomeIsToken0: boolean, buying: boolean): bigint {
  if (targetPriceWad <= 0n) throw new RangeError("a pool price must be above zero");
  // for token0 the sqrt price rises with the outcome's price, for token1 it falls
  const roundUp = buying !== outcomeIsToken0;
  if (outcomeIsToken0) {
    const ratio = targetPriceWad * Q192;
    return roundUp ? isqrtUp((ratio + WAD - 1n) / WAD) : isqrt(ratio / WAD);
  }
  const ratio = Q192 * WAD;
  return roundUp ? isqrtUp((ratio + targetPriceWad - 1n) / targetPriceWad) : isqrt(ratio / targetPriceWad);
}

export interface PoolVolumes {
  /** Outcome tokens that change hands. */
  outcome: bigint;
  /** Underlying against them. */
  underlying: bigint;
}

const FEE_DENOMINATOR = 1_000_000n;

/**
 * What it takes to move the pool to `targetPriceWad`, as magnitudes — the caller knows from the
 * prices whether that is a buy or a sell. Walks the initialised ticks in between, and the side
 * going in includes the pool's fee.
 */
export function volumeUntilPrice(pool: PoolLiquidity, targetPriceWad: bigint): PoolVolumes {
  // a pool that never initialised sits at zero, which would divide by zero below
  if (pool.sqrtPriceX96 <= 0n) return { outcome: 0n, underlying: 0n };

  const target = sqrtPriceX96FromPrice(targetPriceWad, pool.outcomeIsToken0);
  const rising = target > pool.sqrtPriceX96;
  // as in Algebra's swap loop: rising crosses the ticks above the pool's tick, falling its own and those below
  const crossed = pool.ticks
    .filter(({ tick }) => (rising ? tick > pool.tick : tick <= pool.tick))
    .sort((a, b) => (rising ? a.tick - b.tick : b.tick - a.tick));

  let amount0 = 0n;
  let amount1 = 0n;
  let liquidity = pool.liquidity;
  let from = pool.sqrtPriceX96;
  for (const next of [...crossed, null]) {
    const boundary = next === null ? target : sqrtPriceAtTick(next.tick);
    const to = (rising ? boundary < target : boundary > target) ? boundary : target;
    const [lower, upper] = from < to ? [from, to] : [to, from];
    if (lower > 0n && liquidity > 0n) {
      amount0 += (liquidity * Q96 * (upper - lower)) / (lower * upper);
      amount1 += (liquidity * (upper - lower)) / Q96;
    }
    if (to === target || next === null) break;

    liquidity = rising ? liquidity + next.liquidityDelta : liquidity - next.liquidityDelta;
    from = to;
  }

  // a rising sqrt price is token1 going in, a falling one token0
  const kept = FEE_DENOMINATOR - pool.fee;
  const gross = (net: bigint) => (net * FEE_DENOMINATOR + kept - 1n) / kept;
  if (rising) amount1 = gross(amount1);
  else amount0 = gross(amount0);

  return pool.outcomeIsToken0 ? { outcome: amount0, underlying: amount1 } : { outcome: amount1, underlying: amount0 };
}

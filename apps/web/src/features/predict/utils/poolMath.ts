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

export interface PoolVolumes {
  /** Outcome tokens that change hands. */
  outcome: bigint;
  /** Underlying against them. */
  underlying: bigint;
}

/**
 * What it takes to move the pool to `targetPriceWad`, as magnitudes — the caller knows from the
 * prices whether that is a buy or a sell. Exact while the pool's liquidity is one full-range
 * position, which is what both Foresight and Seer seed; a concentrated position would also need
 * the initialised ticks between here and the target.
 */
export function volumeUntilPrice(pool: PoolLiquidity, targetPriceWad: bigint): PoolVolumes {
  const target = sqrtPriceX96FromPrice(targetPriceWad, pool.outcomeIsToken0);
  const [lower, upper] = target < pool.sqrtPriceX96 ? [target, pool.sqrtPriceX96] : [pool.sqrtPriceX96, target];
  // a pool that never initialised sits at zero, which would divide by zero below
  if (lower <= 0n) return { outcome: 0n, underlying: 0n };

  const delta = upper - lower;
  const amount0 = (pool.liquidity * Q96 * delta) / (lower * upper);
  const amount1 = (pool.liquidity * delta) / Q96;

  return pool.outcomeIsToken0 ? { outcome: amount0, underlying: amount1 } : { outcome: amount1, underlying: amount0 };
}

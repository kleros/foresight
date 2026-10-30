import type { Address } from "viem";

import type { PoolBalances, PoolSide, SessionDetail, SessionPool, SessionStats } from "../types";
import { collateralVolume } from "./collateralVolume";

const WAD = 10n ** 18n;

export interface PoolMetrics {
  side: PoolSide;
  /** Volume and notional volume in collateral. */
  volume: number;
  notional: number;
  /** Null until the pool's balances are read. */
  liquidity: {
    /** What the pool holds, in wei. */
    outcome: bigint;
    underlying: bigint;
    /** False while the pool has no price: its outcome tokens are left out of `value`. */
    priced: boolean;
    /** In collateral. */
    value: number;
  } | null;
}

/** Figures in collateral; liquidity null until every pool's balances are read. */
export interface MetricTotals {
  volume: number;
  notional: number;
  liquidity: number | null;
}

export interface OptionMetrics extends MetricTotals {
  market: Address;
  name: string;
  /** UP first. */
  pools: PoolMetrics[];
}

export interface SessionMetrics extends MetricTotals {
  options: OptionMetrics[];
}

const sum = (values: bigint[]) => values.reduce((total, value) => total + value, 0n);

/** Outcome tokens at the pool's price plus its underlying; an unpriced pool's outcome tokens count for nothing. */
function heldUnderlying(pool: SessionPool, held: PoolBalances[string]): bigint {
  const outcome = pool.underlyingPerOutcome === null ? 0n : (held.outcome * pool.underlyingPerOutcome) / WAD;
  return outcome + held.underlying;
}

/**
 * Volume is each pool's underlying leg, notional volume its outcome-token leg valued at one underlying (its
 * most on redeem), liquidity what each pool holds at its price; all in collateral. Null without outcomes.
 */
export function sessionMetrics(
  session: SessionDetail,
  stats: SessionStats,
  balances: PoolBalances | undefined,
): SessionMetrics | null {
  if (session.outcomeCount === 0) return null;
  const collateral = (underlying: bigint) => collateralVolume(session, underlying) ?? 0;

  const totals = (pools: SessionPool[]): MetricTotals => {
    const held = pools.map((pool) => {
      const balance = balances?.[pool.id];
      return balance && heldUnderlying(pool, balance);
    });
    return {
      volume: collateral(sum(pools.map((pool) => pool.volumeUnderlying))),
      notional: collateral(sum(pools.map((pool) => pool.volumeOutcome))),
      liquidity: held.every((each): each is bigint => each !== undefined) ? collateral(sum(held)) : null,
    };
  };

  const poolMetrics = (pool: SessionPool): PoolMetrics => {
    const held = balances?.[pool.id];
    return {
      side: pool.side,
      volume: collateral(pool.volumeUnderlying),
      notional: collateral(pool.volumeOutcome),
      liquidity: held
        ? {
            outcome: held.outcome,
            underlying: held.underlying,
            priced: pool.underlyingPerOutcome !== null,
            value: collateral(heldUnderlying(pool, held)),
          }
        : null,
    };
  };

  return {
    ...totals(stats.pools),
    options: session.options.map((option) => {
      const pools = stats.pools
        .filter((pool) => pool.market === option.market.toLowerCase())
        .sort((a, b) => (a.side === b.side ? 0 : a.side === "UP" ? -1 : 1));
      return { market: option.market, name: option.name, ...totals(pools), pools: pools.map(poolMetrics) };
    }),
  };
}

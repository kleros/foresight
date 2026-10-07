/** One Algebra pool as a trade planner needs it: where it sits, how deep, and which way round. */
export interface PoolLiquidity {
  /** The price the pool is at, as Algebra holds it. */
  sqrtPriceX96: bigint;
  liquidity: bigint;
  outcomeIsToken0: boolean;
}

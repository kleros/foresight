/** A tick some position starts or ends at, and the liquidity crossing it upward adds. */
export interface InitializedTick {
  tick: number;
  liquidityDelta: bigint;
}

/** One Algebra pool as a trade planner needs it: where it sits, how deep, and which way round. */
export interface PoolLiquidity {
  /** The price the pool is at, as Algebra holds it. */
  sqrtPriceX96: bigint;
  /** The tick the pool reports, which says whether a tick the price sits exactly on is already crossed. */
  tick: number;
  /** The active liquidity at the price. */
  liquidity: bigint;
  /** Taken from a swap's input, in millionths. */
  fee: bigint;
  /** The initialised ticks between the price and the one it was read toward; a sizer counts no others. */
  ticks: InitializedTick[];
  outcomeIsToken0: boolean;
}

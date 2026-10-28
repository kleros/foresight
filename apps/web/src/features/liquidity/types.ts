import type { FlowTx } from "@foresight/tx-orchestrator";
import type { Address } from "viem";

/** One child market of a session: its parent outcome `O` and the child's three outcome tokens. */
export interface LiquidityBranchTokens {
  childMarket: Address;
  outcome: Address;
  upToken: Address;
  downToken: Address;
  invalidToken: Address;
}

/** A session's markets and tokens, read from the chain (`wrappedOutcome(i)`), never from the indexer. */
export interface LiquiditySession {
  chainId: number;
  parentMarket: Address;
  /** sDAI: what Seer's router splits and merges against. */
  collateral: Address;
  parentInvalid: Address;
  branches: LiquidityBranchTokens[];
}

/** A (parent outcome, child outcome) pool as read before the run. */
export type PoolState =
  | { status: "missing" }
  | { status: "empty"; sqrtPriceX96: bigint; tickSpacing: number }
  | { status: "live"; sqrtPriceX96: bigint; liquidity: bigint; tickSpacing: number };

export type SeedCollateral = "sDAI" | "xDAI";

export interface SeedBranchInput {
  /** A_O: how much of the parent outcome this branch puts into its two pools. */
  depth: bigint;
  upPriceBps: bigint;
  pools: { up: PoolState; down: PoolState };
}

export interface SeedInput {
  session: LiquiditySession;
  owner: Address;
  /** T: the collateral the run spends, in sDAI or xDAI wei. */
  total: bigint;
  collateral: SeedCollateral;
  /** sDAI shares `total` xDAI deposits to; required for xDAI. */
  previewDeposit?: bigint;
  /** The chain's latest block timestamp, in seconds. */
  chainTime: bigint;
  branches: SeedBranchInput[];
}

/** One full-range seed mint, with the amounts the popup shows. */
export interface PoolPlan {
  token0: Address;
  token1: Address;
  tickLower: number;
  tickUpper: number;
  /** The price the seed mint meets: the pool's own when locked, else the user's. */
  sqrtPriceX96: bigint;
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  create: boolean;
  realign: boolean;
  priceLocked: boolean;
}

export interface BranchPlan {
  depth: bigint;
  split: bigint;
  upPriceBps: bigint;
  downPriceBps: bigint;
  pools: { up: PoolPlan; down: PoolPlan };
}

export interface Leftover {
  token: Address;
  amount: bigint;
}

/** A transaction of a run, or one built from the token id a dust mint returned. */
export type LiquidityStep =
  | { id: string; tx: FlowTx; withdraws?: never; build?: never }
  | { id: string; tx?: never; withdraws: string; build: (minted: { tokenId: bigint }) => FlowTx };

export interface SeedPlan {
  parentSplit: bigint;
  branches: BranchPlan[];
  leftovers: Leftover[];
  steps: LiquidityStep[];
}

export interface RemoveInput {
  chainId: number;
  owner: Address;
  chainTime: bigint;
  /** The pool's current price. */
  sqrtPriceX96: bigint;
  position: {
    tokenId: bigint;
    token0: Address;
    token1: Address;
    tickLower: number;
    tickUpper: number;
    liquidity: bigint;
  };
}

export interface RemovePlan {
  amount0: bigint;
  amount1: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  tx: FlowTx;
}

export interface MergeInput {
  session: LiquiditySession;
  owner: Address;
  /** Wallet balances, one entry per session branch in order. */
  balances: {
    branches: { outcome: bigint; up: bigint; down: bigint; invalid: bigint }[];
    parentInvalid: bigint;
  };
}

export interface MergePlan {
  branches: { merge: bigint }[];
  parentMerge: bigint;
  txs: FlowTx[];
}

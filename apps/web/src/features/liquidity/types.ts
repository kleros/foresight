import type { FlowTx } from "@foresight/tx-orchestrator";
import type { Address, Hash, Hex } from "viem";

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

/** A session and its pools, `branches[i]` the UP and DOWN pool of `session.branches[i]`. */
export interface SessionPools {
  session: LiquiditySession;
  branches: { up: PoolState; down: PoolState }[];
}

/** A wallet's position in one of a session's pools, with what withdrawing all of it returns now (rounded down). */
export interface LiquidityPosition {
  tokenId: bigint;
  token0: Address;
  token1: Address;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
}

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

/** What a pool reads as once a run's own step on it has mined: its liquidity, and its price within [low, high]. */
export interface PoolLeft {
  token0: Address;
  token1: Address;
  liquidity: bigint;
  low: bigint;
  high: bigint;
}

/** A transaction of a run, or one built from the token id a dust mint returned and the pool's price read at build. */
export type LiquidityStep =
  | { id: string; tx: FlowTx; leaves?: PoolLeft; withdraws?: never; build?: never }
  | {
      id: string;
      tx?: never;
      leaves: PoolLeft;
      withdraws: string;
      build: (at: { tokenId: bigint; sqrtPriceX96: bigint }) => FlowTx;
    };

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

/** What the popup reviewed when Add, Remove or Merge was pressed; a seed's `branches[].pools` is the reviewed pool state. */
export type LiquidityRequest =
  | { kind: "seed"; input: SeedInput }
  | { kind: "remove"; session: LiquiditySession; input: RemoveInput }
  | { kind: "merge"; input: MergeInput };

/** The chain reads a liquidity run makes before each prompt. */
export interface LiquidityReader {
  /** The latest block's timestamp, in seconds. */
  chainTime(): Promise<bigint>;
  /** The pair's pool, tokens in either order. */
  pool(tokenA: Address, tokenB: Address): Promise<PoolState>;
  ownerOf(tokenId: bigint): Promise<Address>;
  /** The account's next nonce, counting mined sends only. */
  nextNonce(account: Address): Promise<number>;
  /** A send of the account is broadcast and not yet mined. */
  hasPending(account: Address): Promise<boolean>;
  /** The latest block's number. */
  blockNumber(): Promise<bigint>;
  /** What took `owner`'s `nonce`, looked for from block `fromBlock` on. */
  sentWithNonce(args: { owner: Address; nonce: number; fromBlock: bigint }): Promise<SentWithNonce>;
}

/**
 * An account's send at one nonce: mined with its call, broadcast, unused, or `taken` (mined before the block
 * looked from, or a contract creation).
 */
export type SentWithNonce =
  | { status: "mined"; hash: Hash; to: Address; input: Hex; value: bigint }
  | { status: "pending" }
  | { status: "none" }
  | { status: "taken" };

/** Why a run halted: the orchestrator's own causes, then the liquidity run's. */
export type LiquidityFailureReason =
  | "rejected"
  | "cancelled"
  | "reverted"
  | "rpc"
  | "unknown"
  /** A transaction departs from flow/allowed.ts or the owner rule, so it was not sent. */
  | "unlisted"
  /** A seed or add at or after the session's close by chain time. */
  | "closed"
  /** The run belongs to another account than the connected one, or none is connected. */
  | "wrong-wallet"
  | "wrong-chain"
  /** The account has a send not yet mined, or a sent batch is not yet confirmed. */
  | "pending"
  /** A step was asked of the wallet and the chain shows no send of it; it is never signed again, only discarded. */
  | "held"
  | "storage"
  /** The wallet cannot report a sent batch, so it is never sent again. */
  | "batch-unknown"
  /** The wallet reports the batch did not land. */
  | "batch-failed"
  /** The run's xDAI would leave the account under GAS_RESERVE_WEI (L12), so nothing was sent. */
  | "gas-reserve";

/** Halts whose send may still land: the row it stopped on is not crossed, and the stop is a warning. */
export const MAY_LAND: ReadonlySet<LiquidityFailureReason> = new Set(["pending", "held", "batch-unknown"]);

/** A row's state: `failed` marks the row the run stopped on, unless what it sent may still land. */
export type LiquidityRowView = "idle" | "running" | "done" | "failed";

export interface LiquidityProgressRow {
  /** `parent`, `branch:<i>` or `remove`, in the plan's order. */
  id: string;
  view: LiquidityRowView;
  /** The row's transactions settled and planned. */
  signatures: { done: number; total: number };
}

export interface LiquidityProgress {
  /** `moved`: a pool read at build differs from the reviewed one; nothing more is signed until a new review. */
  stage: "idle" | "signing" | "confirming" | "review" | "moved" | "halted" | "complete";
  failure?: { reason: LiquidityFailureReason; retryable: boolean };
  /** What the run signs; absent before a run. */
  kind?: LiquidityRequest["kind"];
  /** The run is one EIP-5792 batch, so one signature. */
  atomic?: true;
  /** Empty before a run. */
  rows: LiquidityProgressRow[];
  /** Wallet prompts settled and planned: one per transaction, or one for a batch. */
  signatures: { done: number; total: number };
  /** The prompt the run is on: `building` while its transaction is checked against the chain. */
  signature?: { position: number; total: number; status: "building" | "awaiting-signature" | "submitted" };
}

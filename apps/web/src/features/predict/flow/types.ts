import type { Address } from "viem";

import type { PoolLiquidity } from "@/types/pool";

import type { OutcomeBalances } from "../utils/plan";

/**
 * What a prediction is built from. Framework-free, like the rest of `flow/`: the reads and the
 * quotes arrive as ports so the plan can be rebuilt on every attempt without a live client.
 */

/** One option the visitor set an estimate on. */
export interface PredictOption {
  childMarket: Address;
  /** The parent outcome token this option's pools price against. */
  underlying: Address;
  upToken: Address;
  downToken: Address;
  invalidToken: Address;
  /** The visitor's estimate, as the price of the UP token. */
  targetPriceWad: bigint;
}

/** One option as the chain has it now. */
export interface OptionChainState {
  pools: { up: PoolLiquidity; down: PoolLiquidity };
  /** Outcome tokens the executor already holds. */
  held: OutcomeBalances;
  /** The executor's balance of this option's underlying. */
  underlying: bigint;
}

export interface PredictReader {
  /** False until the owner has paid for their executor. */
  isExecutorDeployed(executor: Address): Promise<boolean>;
  /** The session's collateral sitting in the executor. */
  collateralBalance(executor: Address): Promise<bigint>;
  optionStates(args: { options: PredictOption[]; executor: Address }): Promise<OptionChainState[]>;
}

export interface PredictSnapshot {
  options: PredictOption[];
  /** What the visitor chose to add, in the token they chose. */
  deposit: bigint;
  /** Paid as xDAI through the savings adapter rather than as the collateral itself. */
  depositNative: boolean;
  /**
   * Collateral to split at the parent. The chosen amount for a collateral deposit; read back
   * once an xDAI deposit lands, since the adapter's output is not known in advance.
   */
  collateralIn: bigint;
  /** The executor's collateral when the run was planned. Absent on runs persisted before it existed. */
  collateralBefore?: bigint;
  startedAt: number;
}

export interface PredictCtx {
  chainId: number;
  owner: Address;
  /** Deterministic from the owner, so it is known before the executor exists. */
  executor: Address;
  factory: Address;
  /** Seer's router, which splits and merges. */
  router: Address;
  /** What the session's markets are denominated in. */
  collateral: Address;
  parentMarket: Address;
  /** Null where the chain has no savings adapter, which rules out an xDAI deposit. */
  sDaiAdapter: Address | null;
}

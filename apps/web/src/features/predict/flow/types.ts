import type { Address, Hex } from "viem";

import type { CreditsRoute } from "@/config/contracts";

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

/** A transaction the run's owner sent that landed, as the chain's logs show it. */
export interface LandedTx {
  to: Address;
  value: bigint;
  input: Hex;
  /** Collateral it moved into the trade wallet. */
  collateralReceived: bigint;
}

export interface PredictReader {
  /** False until the owner has paid for their executor. */
  isExecutorDeployed(executor: Address): Promise<boolean>;
  /** The session's collateral sitting in the executor. */
  collateralBalance(executor: Address): Promise<bigint>;
  optionStates(args: { options: PredictOption[]; executor: Address }): Promise<OptionChainState[]>;
  /** Foresight credits `holder` holds; none where the chain has no credits. */
  creditsBalance(holder: Address): Promise<bigint>;
  /** The collateral the credits manager holds, which its credits spend one for one. */
  managerCollateral(): Promise<bigint>;
  /** The collateral the vault mints for `assets` of its underlying now. */
  previewDeposit(assets: bigint): Promise<bigint>;
  /** The underlying `shares` of the collateral redeem for now. */
  vaultValue(shares: bigint): Promise<bigint>;
  latestBlock(): Promise<bigint>;
  /**
   * What `owner` sent from `fromBlock` on that landed and moved the collateral or the credits
   * into or out of `executor`.
   */
  landedSince(args: { owner: Address; executor: Address; fromBlock: bigint }): Promise<LandedTx[]>;
  /** True while `owner` has a transaction broadcast and not yet mined. */
  hasPending(owner: Address): Promise<boolean>;
}

export interface PredictSnapshot {
  options: PredictOption[];
  /** What the visitor chose to add, in the token they chose. */
  deposit: bigint;
  /** Paid as xDAI through the savings adapter rather than as the collateral itself. */
  depositNative: boolean;
  /**
   * Collateral to split at the parent, credits apart. The chosen amount for a collateral deposit;
   * read back once an xDAI deposit lands, since the adapter's output is not known in advance.
   */
  collateralIn: bigint;
  /** Credits moved from the owner's wallet to the trade wallet before the spend. */
  creditsFromEoa: bigint;
  /** Credits the first batch burns, swapping as much of the manager's collateral for the split. */
  creditsToSpend: bigint;
  /** The executor's credits read from the chain as the run started, before any transfer. */
  creditsAtStart: bigint;
  /** The trade-wallet collateral the visitor was shown, which the split draws on up to `collateralIn`. */
  collateralBefore: bigint;
  /** The executor's collateral read from the chain as the run started, before any deposit. */
  collateralAtStart: bigint;
  /** The block after the latest as the run started: the first this run's transactions can land in. */
  fromBlock: bigint;
  startedAt: number;
  /** Options that settled batches left out for lack of a route; absent until one does. */
  skipped?: Address[];
}

/** What the visitor asked for; the run adds the chain-read starting balances and block when it starts. */
export type PredictRequest = Omit<PredictSnapshot, "collateralAtStart" | "creditsAtStart" | "fromBlock">;

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
  /** Null where credits cannot fund this session's collateral. */
  credits: CreditsRoute | null;
}

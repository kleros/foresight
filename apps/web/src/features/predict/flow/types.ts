import type { FlowTx } from "@foresight/tx-orchestrator";
import type { Address, Hash, Hex } from "viem";

import type { CreditsRoute } from "@/config/contracts";

import type { PoolLiquidity } from "@/types/pool";

import type { OutcomeBalances, PreviewTrades } from "../utils/plan";

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

/** What became of the owner's transaction with a given nonce. */
export type SentTx =
  | ({ status: "mined"; hash: Hash; success: boolean } & Pick<LandedTx, "to" | "value" | "input">)
  /** Broadcast and not mined. */
  | { status: "pending" }
  /** Used by a transaction not found from the block looked from. */
  | { status: "taken" }
  /** Nothing has used the nonce yet. */
  | { status: "none" };

/** A transaction for the node to estimate, sent from `from`. */
export interface GasEstimateTx {
  from: Address;
  to: Address;
  data?: Hex;
  value?: bigint;
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
  /** The latest block's gas limit, which no one transaction may pass. */
  blockGasLimit(): Promise<bigint>;
  /** The gas the node expects `tx` to use against the latest state; rejects where it would revert. */
  estimateGas(tx: GasEstimateTx): Promise<bigint>;
  /**
   * What `owner` sent from `fromBlock` on that landed and moved the collateral or the credits
   * into or out of `executor`.
   */
  landedSince(args: { owner: Address; executor: Address; fromBlock: bigint }): Promise<LandedTx[]>;
  /** True while `owner` has a transaction broadcast and not yet mined. */
  hasPending(owner: Address): Promise<boolean>;
  /** The nonce `owner`'s next transaction takes, counting those broadcast and not mined. */
  nextNonce(owner: Address): Promise<number>;
  /** `owner`'s transaction with `nonce`, looked for in the blocks from `fromBlock` on. */
  sentWithNonce(args: { owner: Address; nonce: number; fromBlock: bigint }): Promise<SentTx>;
}

/** Hundredths of a percent each kind of swap may pay below its quote before it reverts. */
export interface PredictSlippage {
  /** Every option's sells and buys. */
  tradeBps: number;
  /** The credits manager's swap into xDAI. */
  creditsBps: number;
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
  /** As the visitor's settings had it when the run started; every rebuilt batch keeps it. */
  slippage: PredictSlippage;
  /** Sized from the block gas limit as the run started, so a recovered run re-plans the same batches. */
  optionsPerBatch: number;
  /** Options that settled batches left out for lack of a route; absent until one does. */
  leftOut?: Address[];
  /** Sends that errored after they may have gone out, by step id, until their nonce says how they ended. */
  unanswered?: Record<string, UnansweredSend>;
}

/** A send whose wallet call errored, which the chain may still mine under `nonce`. */
export interface UnansweredSend {
  owner: Address;
  nonce: number;
  /** The latest block as the send went out; the transaction can land no earlier. */
  fromBlock: bigint;
  tx: FlowTx;
}

/** What the visitor asked for; the run adds what it reads from the chain when it starts. */
export type PredictRequest = Omit<
  PredictSnapshot,
  "collateralAtStart" | "creditsAtStart" | "fromBlock" | "optionsPerBatch"
>;

/** A request with its batches sized, which is all a plan needs. */
export type PlannedRequest = PredictRequest & Pick<PredictSnapshot, "optionsPerBatch">;

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

/** The credits swap as quoted: what it pays, what the credits redeem for at the vault, and the floor. */
export interface CreditsSwapPreview {
  /** The credits the swap was quoted for, and the slippage its floor was taken at. */
  amount: bigint;
  creditsBps: number;
  /** WXDAI the quote pays the executor. */
  quoted: bigint;
  /** xDAI the credits' collateral redeems for at the vault's rate. */
  vaultValue: bigint;
  /** The least the swap may pay, `creditsBps` below the quote. */
  floor: bigint;
  /** What the pool's fee and price take against the vault rate; none when the pool pays more. */
  loss: bigint;
  /** Collateral each option splits of the floor: the vault's preview less `MINT_RATE_MARGIN_BPS`. */
  minted: bigint;
}

/** Each option's plan as the popup showed it, keyed by its lower-case child market. */
export type ShownPlans = Readonly<Record<string, PreviewTrades>>;

/** What a run is held to: the plans and the credits swap the visitor saw before signing. */
export interface HeldTo {
  plans: ShownPlans;
  /** Absent where the popup showed no credits swap. */
  credits?: CreditsSwapPreview;
}

/** The options whose plan changed, every option's plan as the pools give it now, and a moved credits swap. */
export interface MovedPlans {
  markets: Address[];
  plans: ShownPlans;
  credits?: CreditsSwapPreview;
  /** Found by re-planning at slippage the visitor changed after the run stopped. */
  bySlippage?: true;
}

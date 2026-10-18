import type { TxErrorCause } from "@foresight/tx-orchestrator";
import type { Address, Hash } from "viem";

import type { PredictSnapshot } from "../flow/types";

/**
 * `no-route`: no option can be moved toward its estimate with what the run has to spend.
 * `quote`: the quoter gave no answer, so whether a route exists is unknown.
 * `balance`: the trade wallet, or the wallet's credits, hold less than the popup counted on.
 * `credits`: the credits manager cannot cover the credits, or its swap would lose too much.
 * `deposit-unconfirmed`: a recovered run's deposit may have been signed with no hash kept.
 * `wrong-wallet`, `wrong-chain`: a saved run belongs to another wallet or network than the connected one.
 */
export type PredictFailureReason =
  | TxErrorCause
  | "no-route"
  | "quote"
  | "funds"
  | "balance"
  | "credits"
  | "deposit-unconfirmed"
  | "wrong-wallet"
  | "wrong-chain";

/** What the popup shows while a prediction runs. */
export type PredictStage =
  /** Nothing started. */
  | "idle"
  /** Between steps: reading the pools and finding prices. */
  | "quoting"
  /** The wallet is open. */
  | "signing"
  /** Broadcast, waiting for the chain. */
  | "confirming"
  /** A stored run, reconciled with the chain, waiting for the visitor to resume it. */
  | "review"
  /** Stopped with something the visitor can act on. */
  | "halted"
  | "complete";

export type StepState = "pending" | "running" | "success" | "error";

export interface PredictStepRow {
  id: string;
  label: string;
  state: StepState;
}

export interface PredictProgress {
  stage: PredictStage;
  steps: PredictStepRow[];
  /** Options no route could be found for, which the run left out. */
  skipped: Address[];
  /** How many of the planned batches have landed, for "3 of 5 went through". */
  batchesDone: number;
  batches: number;
  /** Why it stopped, classified. The chain's own wording names gas and contracts, so it stays out. */
  failure?: { reason: PredictFailureReason; retryable: boolean };
  /** A stopped run's broadcast transaction whose receipt has not been seen: it may still mine. */
  pendingHash?: Hash;
  /** This run sent a deposit or a prediction, so retrying it signs its snapshot, not the form. */
  moneyMoved?: true;
  /** The snapshot of a run restored from storage. It, not the popup's form, is what the run signs. */
  recovered?: PredictSnapshot;
}

export interface PredictDriver {
  /** Starts a run from the form, or loads a stored one for review instead. */
  start(): void;
  /** Loads a stored run for review, reconciled with the chain. Signs nothing. */
  recover(): void;
  /** Continues a run under review. */
  resume(): void;
  retry(): void;
  /** Throws the run away, including anything persisted. Not for a run with a `pendingHash`. */
  reset(): void;
  dispose(): void;
  getProgress(): PredictProgress;
  subscribe(listener: () => void): () => void;
}

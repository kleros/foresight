import type { TxErrorCause } from "@foresight/tx-orchestrator";
import type { Address, Hash } from "viem";

/**
 * `no-route`: no option can be moved toward its estimate with what the run has to spend.
 * `balance`: the trade wallet holds less than the popup counted on.
 * `deposit-unconfirmed`: a recovered run's deposit may have been signed with no hash kept.
 */
export type PredictFailureReason = TxErrorCause | "no-route" | "balance" | "deposit-unconfirmed";

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
}

export interface PredictDriver {
  start(): void;
  retry(): void;
  /** Throws the run away, including anything persisted. Not for a run with a `pendingHash`. */
  reset(): void;
  dispose(): void;
  getProgress(): PredictProgress;
  subscribe(listener: () => void): () => void;
}

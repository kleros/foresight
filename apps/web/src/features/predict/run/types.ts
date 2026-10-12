import type { TxErrorCause } from "@foresight/tx-orchestrator";
import type { Address } from "viem";

/** `no-route`: no option can be moved toward its estimate with what the run has to spend. */
export type PredictFailureReason = TxErrorCause | "no-route";

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
}

export interface PredictDriver {
  start(): void;
  retry(): void;
  /** Throws the run away, including anything persisted. */
  reset(): void;
  dispose(): void;
  getProgress(): PredictProgress;
  subscribe(listener: () => void): () => void;
}

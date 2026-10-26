import type { TxErrorCause } from "@foresight/tx-orchestrator";
import type { Address, Hash } from "viem";

import type { HeldTo, MovedPlans, PredictSnapshot } from "../flow/types";

/**
 * `no-route`: no option can be moved toward its estimate with what the run has to spend.
 * `at-estimates`: every option's pools already sit at its estimate.
 * `quote`: the quoter gave no answer, so whether a route exists is unknown.
 * `balance`: the trade wallet, or the wallet's credits, hold less than the popup counted on.
 * `credits`: the credits manager cannot cover the credits, or no route swaps them as it requires.
 * `deposit-unconfirmed`: a recovered run's deposit may have been signed with no hash kept.
 * `pending`: the wallet has a transaction not yet mined, which may be the step about to be signed again.
 * `wrong-wallet`, `wrong-chain`: a saved run belongs to another wallet or network than the connected one, or the
 * client refused a send before the wallet was asked because the wallet was not connected or on another network.
 * `elsewhere`: another open tab is driving the saved run.
 * `prompt-open`: this tab holds the saved run for a wallet prompt that an earlier popup opened and nobody has answered.
 * `closed`: the session's close time has passed on the chain's clock, so nothing more is signed.
 * `unlisted`: a transaction departs from the chain's allow-list, the owner rule or the native-value rule, so it was not sent.
 * `storage`: the send could not be saved before the wallet prompt, so no prompt was opened.
 * `held`: a send that errored is held while its nonce reads unused, for ten minutes; nothing is signed for it meanwhile.
 * `resign`: a held send's nonce, or a hash no node finds, stayed unused past its hold; retrying signs the step again,
 * which the visitor is asked first.
 * `unseen`: no node finds a sent hash and its nonce reads unused; it is kept for ten minutes from its send.
 */
export type PredictFailureReason =
  | TxErrorCause
  | "no-route"
  | "at-estimates"
  | "quote"
  | "funds"
  | "balance"
  | "credits"
  | "deposit-unconfirmed"
  | "pending"
  | "wrong-wallet"
  | "wrong-chain"
  | "elsewhere"
  | "prompt-open"
  | "closed"
  | "unlisted"
  | "storage"
  | "held"
  | "resign"
  | "unseen";

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
  /** A read of the pools before a batch gives another plan than the run is held to; nothing more is signed until `confirm`. */
  | "moved"
  /** Stopped with something the visitor can act on. */
  | "halted"
  | "complete";

export type StepState = "pending" | "running" | "success" | "error";

export interface PredictStepRow {
  id: string;
  label: string;
  state: StepState;
  /** The transaction a settled step confirmed under; absent where it was skipped. */
  hash?: Hash;
}

export interface PredictProgress {
  stage: PredictStage;
  steps: PredictStepRow[];
  /** Options no route could be found for, which the run left out. */
  leftOut: Address[];
  /** How many of the planned batches have landed, for "3 of 5 went through". */
  batchesDone: number;
  batches: number;
  /** Why it stopped, classified. The chain's own wording names gas and contracts, so it stays out. */
  failure?: { reason: PredictFailureReason; retryable: boolean };
  /** A stopped run's broadcast transaction whose receipt has not been seen: it may still mine. */
  pendingHash?: Hash;
  /** The running step's transaction, stored with the run as sent; recovery waits on it if the popup closes. */
  sentHash?: Hash;
  /** This run sent a deposit or a prediction, so retrying it signs its snapshot, not the form. */
  moneyMoved?: true;
  /** A send the wallet was asked for is held with the run, with no hash stored, until its nonce is read. */
  unanswered?: true;
  /** The snapshot of a run restored from storage. It, not the popup's form, is what the run signs. */
  recovered?: PredictSnapshot;
  /** At the `moved` stage: what changed since the run was held to `held`. */
  moved?: MovedPlans;
  /** The plans and credits quote accepted at Predict, Resume or Confirm. */
  held?: HeldTo;
}

export type { HeldTo, MovedPlans, ShownPlans, ShownQuotes } from "../flow/types";

export interface PredictDriver {
  /**
   * Starts a run from the form, or loads a stored one for review instead. With `held`, every batch
   * reads the pools again before it is signed, and a plan that changed stops the run at `moved`.
   */
  start(held?: HeldTo): void;
  /** Goes on from `moved`, held to what it named; pools that moved again stop it there again. */
  confirm(): void;
  /** Loads a stored run for review, reconciled with the chain. Signs nothing. */
  recover(): void;
  /** Continues a run under review, bound to its displayed quotes when supplied. */
  resume(held?: HeldTo): void;
  retry(held?: HeldTo): void;
  /** Checks an unresolved hash before discarding; keeps the run while the transaction may still land. */
  discard(): void;
  /**
   * Throws the run away, including anything persisted. Refused while a step holds a hash with no receipt read or a held
   * send is unresolved, and for a run stopped at `pending` or `deposit-unconfirmed`.
   */
  reset(): void;
  dispose(): void;
  getProgress(): PredictProgress;
  subscribe(listener: () => void): () => void;
}

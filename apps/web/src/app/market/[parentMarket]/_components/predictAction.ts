import type { PredictStage } from "@/features/predict/run/types";
import type { SessionStatus } from "@/features/sessions/types";

import { stopsSends } from "./statusReason";

/** What the popup's main button does when pressed; `none` does nothing. */
export type PredictAction = "start" | "confirm" | "resume" | "retry" | "none";

export interface PredictActionArgs {
  status: SessionStatus;
  stage: PredictStage;
  /** The run stopped at moved figures and waits for them to be confirmed. */
  isMoved: boolean;
  canRetry: boolean;
  /** A stored run is shown; it is resumed or closed, never replaced by the form. */
  isRecovered: boolean;
  /** A stored run's credits price is read, or it needs none. */
  recoveryPricesReady: boolean;
  /** A sent or held transaction of the run has an outcome still to read from the chain. */
  checksChain: boolean;
}

/**
 * Under a status that stops sends, only a press that reads an outstanding transaction from the chain goes through;
 * the run's own send gate refuses whatever it would sign after that.
 */
export function predictAction(args: PredictActionArgs): PredictAction {
  const { status, stage, isMoved, canRetry, isRecovered, recoveryPricesReady, checksChain } = args;
  if (status === "closed") return "none";
  if (stopsSends(status)) {
    if (!checksChain) return "none";
    if (stage === "review") return "resume";
    return stage === "halted" && canRetry ? "retry" : "none";
  }
  if (isMoved) return "confirm";
  if (isRecovered && !recoveryPricesReady) return "none";
  if (stage === "review") return "resume";
  if (canRetry) return "retry";
  return isRecovered ? "none" : "start";
}

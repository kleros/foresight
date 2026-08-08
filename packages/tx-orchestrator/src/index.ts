/**
 * Runs a queue of transactions one signature at a time, holds the snapshot
 * still while it does, survives a closed tab, and reconciles with the chain on
 * the way back.
 */

export { createTxOrchestrator, type SnapshotPatch, type TxOrchestrator } from "./orchestrator";
export { classifyTxError, describeTxError, FlowStateError, isFatalCause, isRetryableRead } from "./errors";
export { createFlowScope, type FlowScope } from "./scope";
export {
  createFlowRunStore,
  createMemoryStorage,
  fromWebStorage,
  type FlowRunStorage,
  type FlowRunStore,
} from "./storage";
export { createViemTxGateway, type ReceiptClient } from "./viemGateway";
export { decodeState, encodeState } from "./codec";
export {
  currentEntry,
  inFlightEntry,
  isLive,
  isSettled,
  liveEntries,
  liveSteps,
  settledEntries,
  summarise,
} from "./steps";

export {
  DEFAULT_RUN_TTL_MS,
  FLOW_RUN_SCHEMA_VERSION,
  type AfterStepResult,
  type FlowError,
  type FlowHooks,
  type FlowStatus,
  type FlowTx,
  type InFlightStepEntry,
  type LiveOutcome,
  type LiveStepEntry,
  type OnResumeResult,
  type OrchestratorEvent,
  type OrchestratorEventType,
  type OrchestratorRun,
  type PauseReason,
  type PersistedFlowRun,
  type PersistedFlowRunInput,
  type ReconcileOutcome,
  type ReconcileResult,
  type ResumePreflightDiff,
  type RunFacts,
  type RunPhase,
  type RunStatus,
  type SettledOutcome,
  type SnapshotSource,
  type StepEntry,
  type StepOutcome,
  type StepStatus,
  type StepSummary,
  type TxErrorCause,
  type TxGateway,
  type TxReplacement,
  type TxReplacementReason,
  type TxStep,
  type Unsubscribe,
} from "./types";

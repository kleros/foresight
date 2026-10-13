import type { FlowRunStore, PersistedFlowRun } from "@foresight/tx-orchestrator";
import type { Address } from "viem";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import type { PredictCtx, PredictSnapshot } from "../flow/types";

/** Where one owner's prediction run for a session is stored, per chain. */
export const predictFlowId = (sessionId: string, owner: Address, chainId: number = DEFAULT_CHAIN_ID) =>
  `predict-${chainId}-${owner.toLowerCase()}-${sessionId}`;

/** The session-only key unscoped runs were saved under; read only to adopt or discard them. */
export const legacyPredictFlowId = (sessionId: string) => `predict-${sessionId}`;

const ownRun = (store: FlowRunStore, flowId: string, owner: Address) => {
  const run = store.load<PredictSnapshot, PredictCtx>(flowId);
  return run && run.ctx.owner.toLowerCase() === owner.toLowerCase() ? run : null;
};

const sessionRun = (store: FlowRunStore, sessionId: string, owner: Address) =>
  ownRun(store, predictFlowId(sessionId, owner), owner) ?? ownRun(store, legacyPredictFlowId(sessionId), owner);

/** The snapshot of `owner`'s unfinished stored run for this session, if there is one. */
export function findInterruptedRun(store: FlowRunStore, sessionId: string, owner: Address): PredictSnapshot | null {
  return sessionRun(store, sessionId, owner)?.snapshot ?? null;
}

const awaitsReceipt = (run: PersistedFlowRun<PredictSnapshot, PredictCtx>) =>
  run.steps.some((step) => step.outcome.status === "submitted");

/** True while `owner`'s stored run holds a broadcast hash with no receipt; only resuming reconciles it. */
export function hasPendingTransaction(store: FlowRunStore, sessionId: string, owner: Address): boolean {
  const run = sessionRun(store, sessionId, owner);
  return Boolean(run && awaitsReceipt(run));
}

/** Forgets `owner`'s stored run for this session unless it awaits a receipt; another owner's run is left alone. */
export function discardRun(store: FlowRunStore, sessionId: string, owner: Address) {
  for (const flowId of [predictFlowId(sessionId, owner), legacyPredictFlowId(sessionId)]) {
    const run = ownRun(store, flowId, owner);
    if (run && !awaitsReceipt(run)) store.clear(flowId);
  }
}

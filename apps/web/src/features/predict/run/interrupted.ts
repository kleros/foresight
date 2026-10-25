import type { FlowRunStore, PersistedFlowRun } from "@foresight/tx-orchestrator";
import type { Address } from "viem";

import { createRunStore } from "@/lib/flowRunStore";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import type { PredictCtx, PredictSnapshot } from "../flow/types";

/** Where one owner's prediction run for a session is stored, per chain. */
export const predictFlowId = (sessionId: string, owner: Address, chainId: number = DEFAULT_CHAIN_ID) =>
  `predict-${chainId}-${owner.toLowerCase()}-${sessionId}`;

const ownRun = (store: FlowRunStore, flowId: string, owner: Address) => {
  const run = store.load<PredictSnapshot, PredictCtx>(flowId);
  return run && run.ctx.owner.toLowerCase() === owner.toLowerCase() ? run : null;
};

const sessionRun = (store: FlowRunStore, sessionId: string, owner: Address) =>
  ownRun(store, predictFlowId(sessionId, owner), owner);

/** The snapshot of `owner`'s unfinished stored run for this session, if there is one. */
export function findInterruptedRun(store: FlowRunStore, sessionId: string, owner: Address): PredictSnapshot | null {
  return sessionRun(store, sessionId, owner)?.snapshot ?? null;
}

/** True while `snapshot` holds a send that errored and whose nonce has not been read as settled. */
export const hasUnanswered = (snapshot: Readonly<PredictSnapshot> | undefined): boolean =>
  Object.keys(snapshot?.unanswered ?? {}).length > 0;

/** A run that holds a send with no answer read stays stored past its expiry; the store prunes it once settled. */
export const unsettledRun = (run: PersistedFlowRun<unknown, unknown>): boolean =>
  hasUnanswered(run.snapshot as Readonly<PredictSnapshot> | undefined);

/** This browser's store of prediction runs. */
export const predictRunStore = (): FlowRunStore => createRunStore(unsettledRun);

const awaitsReceipt = (run: PersistedFlowRun<PredictSnapshot, PredictCtx>) =>
  run.steps.some((step) => step.outcome.status === "submitted") || hasUnanswered(run.snapshot);

/** True while `owner`'s stored run holds a broadcast hash with no receipt, or a send with no answer; only resuming reconciles it. */
export function hasPendingTransaction(store: FlowRunStore, sessionId: string, owner: Address): boolean {
  const run = sessionRun(store, sessionId, owner);
  return Boolean(run && awaitsReceipt(run));
}

/** Forgets `owner`'s stored run for this session unless it awaits a receipt or an answer; another owner's run is left alone. */
export function discardRun(store: FlowRunStore, sessionId: string, owner: Address) {
  const run = sessionRun(store, sessionId, owner);
  if (run && !awaitsReceipt(run)) store.clear(predictFlowId(sessionId, owner));
}

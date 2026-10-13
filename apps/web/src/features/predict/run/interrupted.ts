import type { FlowRunStore } from "@foresight/tx-orchestrator";
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
  return run && run.ctx.owner.toLowerCase() === owner.toLowerCase() && run.ctx.chainId === DEFAULT_CHAIN_ID ? run : null;
};

/** The snapshot of `owner`'s unfinished stored run for this session, if there is one. */
export function findInterruptedRun(store: FlowRunStore, sessionId: string, owner: Address): PredictSnapshot | null {
  const run = ownRun(store, predictFlowId(sessionId, owner), owner) ?? ownRun(store, legacyPredictFlowId(sessionId), owner);
  return run?.snapshot ?? null;
}

/** Forgets `owner`'s stored run for this session; another owner's run is left alone. */
export function discardRun(store: FlowRunStore, sessionId: string, owner: Address) {
  store.clear(predictFlowId(sessionId, owner));
  if (ownRun(store, legacyPredictFlowId(sessionId), owner)) store.clear(legacyPredictFlowId(sessionId));
}

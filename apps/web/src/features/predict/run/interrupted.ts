import type { FlowRunStore } from "@foresight/tx-orchestrator";
import type { Address } from "viem";

import type { PredictCtx, PredictSnapshot } from "../flow/types";

/** Where a session's prediction run is stored. One per session, whoever the owner. */
export const predictFlowId = (sessionId: string) => `predict-${sessionId}`;

/** The snapshot of `owner`'s unfinished stored run for this session, if there is one. */
export function findInterruptedRun(store: FlowRunStore, sessionId: string, owner: Address): PredictSnapshot | null {
  const run = store.load<PredictSnapshot, PredictCtx>(predictFlowId(sessionId));
  return run?.ctx.owner.toLowerCase() === owner.toLowerCase() ? run.snapshot : null;
}

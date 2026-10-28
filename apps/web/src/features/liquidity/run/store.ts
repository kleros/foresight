import type { FlowRunStore, PersistedFlowRun } from "@foresight/tx-orchestrator";

import { createRunStore } from "@/lib/flowRunStore";

import { BATCH, type LiquiditySnapshot } from "./driver";

/** A run holding a send or a batch id whose step has not settled stays stored past its expiry (L8, L9). */
export function unsettledLiquidityRun(run: PersistedFlowRun<unknown, unknown>): boolean {
  const snapshot = run.snapshot as Partial<LiquiditySnapshot> | undefined;
  const open = new Set(
    run.steps
      .filter((step) => step.outcome.status !== "confirmed" && step.outcome.status !== "skipped")
      .map((step) => step.stepId),
  );
  return (
    Object.keys(snapshot?.sends ?? {}).some((stepId) => open.has(stepId)) ||
    (snapshot?.callsId !== undefined && open.has(BATCH))
  );
}

/** This browser's store of liquidity runs. */
export const liquidityRunStore = (): FlowRunStore => createRunStore(unsettledLiquidityRun);

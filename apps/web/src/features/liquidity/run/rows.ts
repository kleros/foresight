import { isAddressEqual } from "viem";

import { planMerge, planRemove, planSeed } from "../flow/plan";
import { LIQUIDITY_ALLOW_LIST } from "../oracle/allowlist";
import type { LiquidityRequest, LiquidityStep } from "../types";

/** The request's steps, with deadlines from `chainTime` where given; ids do not depend on it. */
export function plannedSteps(request: LiquidityRequest, chainTime?: bigint): LiquidityStep[] {
  switch (request.kind) {
    case "seed":
      return planSeed({ ...request.input, chainTime: chainTime ?? request.input.chainTime }).steps;
    case "remove":
      return [
        { id: "remove", tx: planRemove({ ...request.input, chainTime: chainTime ?? request.input.chainTime }).tx },
      ];
    case "merge":
      return planMerge(request.input).txs.map((tx, index) => ({ id: `merge:${index}`, tx }));
  }
}

/** One row of the popup's steps: `parent`, `branch:<i>` or `remove`, and the run's steps it covers, in order. */
export interface RunRow {
  id: string;
  stepIds: string[];
}

/** A seed step's row: `branch:<i>:…` belongs to branch i, everything else to the parent split. */
const seedRow = (stepId: string) => {
  const [scope, index] = stepId.split(":");
  return scope === "branch" ? `branch:${index}` : "parent";
};

/**
 * The popup's rows for `request`: a seed's parent split and each branch, a remove's one withdrawal, a merge's
 * branch merges then the parent's, each a run of approvals that ends in the router's mergePositions.
 */
export function rowsOf(request: LiquidityRequest, steps: LiquidityStep[] = plannedSteps(request)): RunRow[] {
  if (request.kind === "remove") return [{ id: "remove", stepIds: steps.map((step) => step.id) }];
  if (request.kind === "seed") {
    const rows: RunRow[] = [];
    for (const step of steps) {
      const id = seedRow(step.id);
      const last = rows.at(-1);
      if (last?.id === id) last.stepIds.push(step.id);
      else rows.push({ id, stepIds: [step.id] });
    }
    return rows;
  }
  const router = LIQUIDITY_ALLOW_LIST[request.input.session.chainId]?.gnosisRouter;
  const plan = planMerge(request.input);
  const ids = [
    ...plan.branches.flatMap(({ merge }, index) => (merge > 0n ? [`branch:${index}`] : [])),
    ...(plan.parentMerge > 0n ? ["parent"] : []),
  ];
  const rows: RunRow[] = [];
  let open: string[] = [];
  for (const step of steps) {
    open.push(step.id);
    if (router && step.tx && isAddressEqual(step.tx.to, router)) {
      rows.push({ id: ids[rows.length] ?? `merge:${rows.length}`, stepIds: open });
      open = [];
    }
  }
  if (open.length > 0) rows.push({ id: ids[rows.length] ?? `merge:${rows.length}`, stepIds: open });
  return rows;
}

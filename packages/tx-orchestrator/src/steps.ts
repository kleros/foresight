import { FlowStateError } from "./errors";
import type { InFlightStepEntry, LiveStepEntry, StepEntry, StepOutcome, StepSummary, TxStep } from "./types";

/**
 * Reading and advancing the step list.
 *
 * The list is ordered and settles from the front.
 */

const SETTLED: StepOutcome["status"][] = ["confirmed", "skipped"];

export function isSettled<TSnapshot, TCtx>(
  entry: StepEntry<TSnapshot, TCtx>,
): entry is Extract<StepEntry<TSnapshot, TCtx>, { outcome: { status: "confirmed" | "skipped" } }> {
  return SETTLED.includes(entry.outcome.status);
}

export function isLive<TSnapshot, TCtx>(entry: StepEntry<TSnapshot, TCtx>): entry is LiveStepEntry<TSnapshot, TCtx> {
  return !isSettled(entry);
}

/** A freshly planned step: nothing has happened to it yet. */
export function planned<TSnapshot, TCtx>(step: TxStep<TSnapshot, TCtx>): StepEntry<TSnapshot, TCtx> {
  return { stepId: step.id, label: step.label, outcome: { status: "pending" }, step };
}

export function summarise<TSnapshot, TCtx>(entry: StepEntry<TSnapshot, TCtx>): StepSummary {
  return { stepId: entry.stepId, label: entry.label, outcome: entry.outcome };
}

/** The step the run is on, or the next one owed.
 *  `undefined` when the queue is done. */
export function currentEntry<TSnapshot, TCtx>(
  entries: StepEntry<TSnapshot, TCtx>[],
): LiveStepEntry<TSnapshot, TCtx> | undefined {
  return entries.find(isLive);
}

/** The step with a wallet open or a transaction on chain, if any. */
export function inFlightEntry<TSnapshot, TCtx>(
  entries: StepEntry<TSnapshot, TCtx>[],
): InFlightStepEntry<TSnapshot, TCtx> | undefined {
  return entries.find(
    (entry): entry is InFlightStepEntry<TSnapshot, TCtx> =>
      entry.outcome.status === "awaiting-signature" || entry.outcome.status === "submitted",
  );
}

export function settledEntries<TSnapshot, TCtx>(entries: StepEntry<TSnapshot, TCtx>[]): StepSummary[] {
  return entries.filter(isSettled).map(summarise);
}

export function liveEntries<TSnapshot, TCtx>(entries: StepEntry<TSnapshot, TCtx>[]): StepSummary[] {
  return entries.filter(isLive).map(summarise);
}

export function liveSteps<TSnapshot, TCtx>(entries: StepEntry<TSnapshot, TCtx>[]): TxStep<TSnapshot, TCtx>[] {
  return entries.filter(isLive).map((entry) => entry.step);
}

/** Ids are how a plan is matched to a run, so they have to be unique within one. */
export function assertUniqueIds(steps: { id: string }[]): void {
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) {
      throw new FlowStateError(`Two steps share the id "${step.id}". Step ids have to be unique within a plan.`);
    }
    seen.add(step.id);
  }
}

/**
 * Moves one step to a new outcome. A settled step is never taken back to a live
 * one, which callers rely on to reset a step without checking it first.
 */
export function withOutcome<TSnapshot, TCtx>(
  entries: StepEntry<TSnapshot, TCtx>[],
  stepId: string,
  outcome: StepOutcome,
): StepEntry<TSnapshot, TCtx>[] {
  return entries.map((entry) => {
    if (entry.stepId !== stepId) return entry;
    if (outcome.status === "confirmed" || outcome.status === "skipped") {
      return { stepId: entry.stepId, label: entry.label, outcome };
    }
    return isLive(entry) ? { ...entry, outcome } : entry;
  });
}

/**
 * Swaps out everything not yet settled, keeping the settled ones as a prefix.
 *
 * A step still in flight keeps its outcome when the new plan has its id, so a
 * re-plan cannot drop a hash that is already on chain. A confirmed id throws.
 * A skipped one is allowed and supersedes the old record.
 */
export function replaceLive<TSnapshot, TCtx>(
  entries: StepEntry<TSnapshot, TCtx>[],
  steps: TxStep<TSnapshot, TCtx>[],
): StepEntry<TSnapshot, TCtx>[] {
  assertUniqueIds(steps);

  const planning = new Set(steps.map((step) => step.id));
  for (const entry of entries) {
    if (entry.outcome.status === "confirmed" && planning.has(entry.stepId)) {
      throw new FlowStateError(
        `Step "${entry.stepId}" has already been confirmed on chain and cannot be planned again. Leave settled steps out of the plan.`,
      );
    }
  }

  // At most one, since the loop runs a single step at a time.
  const flying = inFlightEntry(entries);

  return [
    ...entries.filter((entry) => isSettled(entry) && !planning.has(entry.stepId)),
    ...steps.map((step) =>
      step.id === flying?.stepId
        ? { stepId: step.id, label: step.label, outcome: flying.outcome, step }
        : planned<TSnapshot, TCtx>(step),
    ),
  ];
}

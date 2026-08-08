import { FlowStateError } from "./errors";
import { summarise, withOutcome } from "./steps";
import type { FlowRunStore } from "./storage";
import type {
  OrchestratorEvent,
  OrchestratorRun,
  PersistedFlowRun,
  RunFacts,
  RunPhase,
  SnapshotSource,
  StepEntry,
  StepOutcome,
  TxStep,
} from "./types";

/** `prev` is readonly because the live snapshot is frozen: fold into a new object. */
export type SnapshotPatch<TSnapshot> = Partial<TSnapshot> | ((prev: Readonly<TSnapshot>) => TSnapshot);

/** The check below fails the build if `RunPhase` grows a key not listed here. */
const PHASE_KEYS = ["status", "reason", "error"] as const;
type PhaseKey = (typeof PHASE_KEYS)[number];
type KeysOfPhase = RunPhase extends infer T ? (T extends unknown ? keyof T : never) : never;
type _EveryPhaseKeyIsListed = Exclude<KeysOfPhase, PhaseKey> extends never ? true : never;
const _phaseKeysAreComplete: _EveryPhaseKeyIsListed = true;

function factsOf<TSnapshot, TCtx>(run: OrchestratorRun<TSnapshot, TCtx>): RunFacts<TSnapshot, TCtx> {
  const copy = { ...run } as Record<string, unknown>;
  for (const key of PHASE_KEYS) delete copy[key];
  return copy as RunFacts<TSnapshot, TCtx>;
}

export interface RunState<TSnapshot, TCtx> {
  get(): OrchestratorRun<TSnapshot, TCtx> | null;
  /** For lifecycle calls that make no sense without a run. Throws `FlowStateError`. */
  require(action: string): OrchestratorRun<TSnapshot, TCtx>;
  open(run: OrchestratorRun<TSnapshot, TCtx>): void;
  close(): void;
  update(patch: Partial<RunFacts<TSnapshot, TCtx>>): void;
  transition(phase: RunPhase): void;
  /** Moves one step along. A settled step is never moved back. */
  setOutcome(stepId: string, outcome: StepOutcome): void;
  /** Patches snapshot and notifies. The only path a snapshot changes by. */
  patchSnapshot(patch: SnapshotPatch<TSnapshot>, source: SnapshotSource): void;
  /** Writes the run as it stands. A completed run is cleared instead of saved. */
  persist(): void;
  clearStorage(flowId: string): void;
}

export function createRunState<TSnapshot, TCtx>(opts: {
  store?: FlowRunStore;
  emit: (event: OrchestratorEvent<TSnapshot, TCtx>) => void;
  notify: () => void;
}): RunState<TSnapshot, TCtx> {
  const { store, emit, notify } = opts;
  let run: OrchestratorRun<TSnapshot, TCtx> | null = null;
  /** Said once per run: a broken store fails on every write, not just one. */
  let warnedAboutStorage = false;

  /** A store that cannot write costs the safety net, not the run. */
  function touchStorage(write: () => void): void {
    if (!store) return;
    try {
      write();
    } catch (error) {
      console.error("[tx-orchestrator] the run could not be written to storage", error);
      if (warnedAboutStorage) return;
      warnedAboutStorage = true;
      emit({
        type: "inform",
        message: "This flow could not be saved, so it cannot be resumed if the tab closes.",
      });
    }
  }

  /** `getRun()` hands out the real objects, so the lock has to be on them. Shallow. */
  function seal(next: OrchestratorRun<TSnapshot, TCtx>) {
    Object.freeze(next.snapshot);
    Object.freeze(next.steps);
    return next;
  }

  function update(patch: Partial<RunFacts<TSnapshot, TCtx>>) {
    if (!run) return;
    run = seal({ ...run, ...patch } as OrchestratorRun<TSnapshot, TCtx>);
    notify();
  }

  return {
    get: () => run,

    require(action) {
      if (!run) throw new FlowStateError(`Cannot ${action}: no run is active.`);
      return run;
    },

    open(next) {
      run = seal(next);
      warnedAboutStorage = false;
      notify();
    },

    close() {
      run = null;
      notify();
    },

    update,

    transition(phase) {
      if (!run) return;
      run = { ...factsOf(run), ...phase };
      notify();
    },

    setOutcome(stepId, outcome) {
      if (!run) return;
      update({ steps: withOutcome(run.steps, stepId, outcome) });
    },

    patchSnapshot(next, source) {
      if (!run) return;
      const snapshot =
        typeof next === "function"
          ? (next as (prev: TSnapshot) => TSnapshot)(run.snapshot)
          : { ...run.snapshot, ...next };
      update({ snapshot });
      emit({ type: "snapshot:updated", snapshot, source });
    },

    persist() {
      if (!run || !store) return;
      const current = run;
      if (current.status === "completed") {
        touchStorage(() => store.clear(current.flowId));
        return;
      }
      const phase: Extract<RunPhase, { status: "running" | "paused" | "failed" }> =
        current.status === "paused"
          ? { status: "paused", reason: current.reason, ...(current.error ? { error: current.error } : {}) }
          : current.status === "failed"
            ? { status: "failed", error: current.error }
            : { status: "running" };

      touchStorage(() =>
        store.save<TSnapshot, TCtx>({
          flowId: current.flowId,
          adapterId: current.adapterId,
          snapshot: current.snapshot,
          ctx: current.ctx,
          steps: current.steps.map(summarise),
          ...phase,
        }),
      );
    },

    clearStorage: (flowId) => touchStorage(() => store?.clear(flowId)),
  };
}

/**
 * Rebuilds a persisted run against a freshly planned one, matching **by id**.
 *
 * Only steps that might still run need a match: a settled step keeps its
 * result and needs no builder. A re-plan that has lost a live step would either
 * skip work or repeat it, and neither is recoverable, so that throws rather
 * than guessing.
 */
export function restoreRun<TSnapshot, TCtx>(
  persisted: PersistedFlowRun<TSnapshot, TCtx>,
  steps: TxStep<TSnapshot, TCtx>[],
): OrchestratorRun<TSnapshot, TCtx> {
  const byId = new Map(steps.map((step) => [step.id, step]));

  const entries: StepEntry<TSnapshot, TCtx>[] = persisted.steps.map(({ stepId, label, outcome }) => {
    if (outcome.status === "confirmed" || outcome.status === "skipped") return { stepId, label, outcome };

    const step = byId.get(stepId);
    if (!step) {
      throw new FlowStateError(
        `Cannot resume "${persisted.flowId}": the plan no longer contains step "${stepId}". Trash the run and start again.`,
      );
    }
    return { stepId, label, outcome, step };
  });

  const phase: RunPhase =
    persisted.status === "failed"
      ? { status: "failed", error: persisted.error }
      : persisted.status === "paused"
        ? { status: "paused", reason: persisted.reason, ...(persisted.error ? { error: persisted.error } : {}) }
        : // Persisted mid-run: the tab went away. That is not a pause anyone asked for.
          { status: "paused", reason: "interrupted" };

  return {
    flowId: persisted.flowId,
    adapterId: persisted.adapterId,
    snapshot: persisted.snapshot,
    ctx: persisted.ctx,
    steps: entries,
    startedAt: persisted.persistedAt,
    persistedAt: persisted.persistedAt,
    ...phase,
  };
}

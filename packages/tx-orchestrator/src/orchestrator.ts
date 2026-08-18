import { createFlowDriver } from "./driver";
import { createEmitter, createNotifier, type EventOfType } from "./emitter";
import { classifyTxError, FlowStateError } from "./errors";
import { createReceiptWatcher } from "./receiptWatcher";
import { reconcileInFlight } from "./reconcile";
import { createRunState, restoreRun, type SnapshotPatch } from "./runState";
import { createFlowScope, type FlowScope } from "./scope";
import { assertUniqueIds, inFlightEntry, liveEntries, liveSteps, planned, replaceLive, settledEntries } from "./steps";
import type { FlowRunStore } from "./storage";
import type {
  FlowHooks,
  FlowStatus,
  OrchestratorEvent,
  OrchestratorEventType,
  OrchestratorRun,
  PersistedFlowRun,
  ReconcileResult,
  ResumePreflightDiff,
  SnapshotSource,
  TxErrorCause,
  TxGateway,
  TxStep,
  Unsubscribe,
} from "./types";

export type { SnapshotPatch };

/** Distinguishes orchestrators sharing a `FlowScope`. */
let orchestratorCount = 0;

const DEFAULT_RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 1_000;
const RETRY_CEILING_MS = 8_000;

const defaultBackoff = (attempt: number) => Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_CEILING_MS);

/** Abortable, so a trashed run does not hold a timer. The caller re-checks after. */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

export interface TxOrchestrator<TSnapshot, TCtx> {
  /**
   * Runs a flow to its next resting place. Settling is not a success signal: it
   * means `completed`, `paused` or `failed`. Read `getStatus()`.
   */
  start(args: { flowId: string; snapshot: TSnapshot; ctx: TCtx; steps: TxStep<TSnapshot, TCtx>[] }): Promise<void>;

  /** Appends steps to a live run. Ids already in the run are rejected. */
  enqueue(steps: TxStep<TSnapshot, TCtx>[]): void;
  /** Swaps out everything not yet run. Naming a confirmed step throws. */
  replacePending(steps: TxStep<TSnapshot, TCtx>[]): void;

  updateSnapshot(patch: SnapshotPatch<TSnapshot>, meta: { source: SnapshotSource }): void;

  /** Stops at the next safe checkpoint. A broadcast transaction is left on chain, its hash persisted. */
  pause(): void;
  resume(): Promise<void>;
  /**
   * Discards the run and its storage, reporting any broadcast transaction as
   * abandoned. A `flowId` discards a stored run without restoring it first.
   * With neither, nothing is discarded and nothing is announced.
   */
  trash(flowId?: string): void;

  /**
   * Lets go of this orchestrator without discarding anything. The loop stops,
   * the scope hold is released, and the persisted run is left where it is, so
   * a later instance can restore it.
   */
  dispose(): void;

  /** Hydrates a persisted run for review. Steps must be re-planned by the adapter and are matched by id. */
  restore(args: { flowId: string; steps: TxStep<TSnapshot, TCtx>[] }): PersistedFlowRun<TSnapshot, TCtx> | null;
  /** Checks chain and adapter before the resume decision, so nobody signs blind. */
  preflight(): Promise<ResumePreflightDiff>;
  /** Works out what happened to a transaction that was in flight when the flow was interrupted. */
  reconcileInFlight(): Promise<ReconcileResult>;

  getRun(): OrchestratorRun<TSnapshot, TCtx> | null;
  getStatus(): FlowStatus;
  /**
   * This adapter's incomplete runs, what the resume gate reads. Other adapters'
   * records are left out, since `restore` would refuse them anyway.
   */
  listPersisted(): PersistedFlowRun<TSnapshot, TCtx>[];

  /** The handler is given the event it subscribed to; `"*"` gets all of them. */
  on<TType extends OrchestratorEventType | "*">(
    type: TType,
    handler: (event: EventOfType<OrchestratorEvent<TSnapshot, TCtx>, TType>) => void,
  ): Unsubscribe;
  /** Fires on any state change. */
  subscribe(listener: () => void): Unsubscribe;
}

/** Assembles the pieces. What lives here is the order they may happen in. */
export function createTxOrchestrator<TSnapshot, TCtx>(opts: {
  adapterId: string;
  gateway: TxGateway;
  store?: FlowRunStore;
  scope?: FlowScope;
  hooks?: FlowHooks<TSnapshot, TCtx>;
  now?: () => number;
  confirmations?: number;
  /** Read-side retries only. A signature is never re-requested silently. */
  retry?: { maxAttempts?: number; delayMs?: (attempt: number) => number };
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  classifyError?: (error: unknown) => TxErrorCause;
}): TxOrchestrator<TSnapshot, TCtx> {
  const { adapterId, gateway, store } = opts;
  const hooks = opts.hooks ?? {};
  const scope = opts.scope ?? createFlowScope();
  const scopeOwner = `${adapterId}#${++orchestratorCount}`;
  const now = opts.now ?? (() => Date.now());
  const classify = opts.classifyError ?? classifyTxError;

  const emitter = createEmitter<OrchestratorEvent<TSnapshot, TCtx>>();
  const changes = createNotifier();
  const emit = emitter.emit;

  const state = createRunState<TSnapshot, TCtx>({ store, emit, notify: changes.notify });

  const watcher = createReceiptWatcher({
    gateway,
    confirmations: opts.confirmations,
    classify,
    maxAttempts: opts.retry?.maxAttempts ?? DEFAULT_RETRY_ATTEMPTS,
    delayMs: opts.retry?.delayMs ?? defaultBackoff,
    sleep: opts.sleep ?? defaultSleep,
  });

  const driver = createFlowDriver<TSnapshot, TCtx>({
    state,
    gateway,
    watcher,
    scope,
    scopeOwner,
    hooks,
    emit,
    classify,
  });

  /** Chain reads rewrite step outcomes, which under the loop can overwrite a live hash. */
  function refuseWhileRunning(action: string) {
    if (state.get()?.status === "running") {
      throw new FlowStateError(`Cannot ${action} while the run is going. Pause it first.`);
    }
  }

  /** Storage keys carry no `adapterId`, so ownership is decided here, once. */
  function storedRun(flowId: string, action: string): PersistedFlowRun<TSnapshot, TCtx> | null {
    const stored = store?.load<TSnapshot, TCtx>(flowId) ?? null;
    if (stored && stored.adapterId !== adapterId) {
      throw new FlowStateError(
        `Cannot ${action} "${flowId}": it belongs to adapter "${stored.adapterId}", not "${adapterId}". Give this store its own namespace, or pick a different flowId.`,
      );
    }
    return stored;
  }

  return {
    async start({ flowId, snapshot, ctx, steps }) {
      const active = state.get();
      if (active?.status === "running") {
        throw new FlowStateError(`Cannot start "${flowId}": run "${active.flowId}" is still going.`);
      }
      if (active && (active.status === "paused" || active.status === "failed")) {
        throw new FlowStateError(
          `Cannot start "${flowId}": run "${active.flowId}" is paused, resume or trash it first.`,
        );
      }
      // Storage may hold a run whose transaction is already on chain.
      if (storedRun(flowId, "start")) {
        throw new FlowStateError(
          `Cannot start "${flowId}": an unfinished run is already stored for it. Restore it, or discard it with trash("${flowId}").`,
        );
      }
      assertUniqueIds(steps);
      state.open({
        flowId,
        adapterId,
        status: "running",
        snapshot,
        ctx,
        steps: steps.map(planned<TSnapshot, TCtx>),
        startedAt: now(),
      });
      emit({ type: "flow:started", flowId, total: steps.length });
      await driver.drive();
    },

    enqueue(steps) {
      const active = state.require("enqueue steps");
      if (active.status === "completed") throw new FlowStateError("Cannot enqueue steps: the run already finished.");
      // Against the run and against each other.
      const taken = new Set(active.steps.map((entry) => entry.stepId));
      for (const step of steps) {
        if (taken.has(step.id)) {
          throw new FlowStateError(`Cannot enqueue "${step.id}": that step id is already taken.`);
        }
        taken.add(step.id);
      }
      state.update({ steps: [...active.steps, ...steps.map(planned<TSnapshot, TCtx>)] });
      state.persist();
    },

    replacePending(steps) {
      const active = state.require("replace pending steps");
      if (active.status === "completed") throw new FlowStateError("Cannot replace steps: the run already finished.");
      state.update({ steps: replaceLive(active.steps, steps) });
      state.persist();
    },

    updateSnapshot(patch, meta) {
      const active = state.require("update the snapshot");
      if (meta.source === "user" && (active.status === "running" || active.status === "paused")) {
        throw new FlowStateError(
          "The snapshot is locked while a run is active. Trash the run to edit, then start a new one.",
        );
      }
      state.patchSnapshot(patch, meta.source);
      state.persist();
    },

    pause() {
      driver.requestPause();
    },

    async resume() {
      const active = state.require("resume");
      if (active.status === "running") throw new FlowStateError("The run is already going.");
      if (active.status === "completed") throw new FlowStateError("The run already finished.");
      emit({ type: "flow:resuming" });
      await driver.drive();
    },

    trash(flowId) {
      const active = state.get();

      if (active && flowId && flowId !== active.flowId) {
        throw new FlowStateError(
          `Cannot trash "${flowId}": run "${active.flowId}" is the one that is restored. Trash it first.`,
        );
      }

      // Nothing to discard, so nothing to announce.
      const target = active?.flowId ?? flowId;
      if (!target) return;

      // Not ours to delete, and an absent record discarded nothing.
      if (!active && !storedRun(target, "trash")) return;

      const flying = inFlightEntry(active?.steps ?? [])?.outcome;
      driver.cancel();
      state.close();
      state.clearStorage(target);
      scope.unfreeze(scopeOwner);
      emit({ type: "flow:trashed", ...(flying?.status === "submitted" ? { abandoned: flying.hash } : {}) });
    },

    dispose() {
      driver.cancel();
      state.close();
      scope.unfreeze(scopeOwner);
    },

    restore({ flowId, steps }) {
      const active = state.get();
      if (active?.status === "running") {
        throw new FlowStateError(`Cannot restore "${flowId}": run "${active.flowId}" is still going.`);
      }
      const persisted = storedRun(flowId, "restore");
      if (!persisted) return null;

      state.open(restoreRun(persisted, steps));
      scope.freeze(scopeOwner, `Transaction flow ${flowId}`);
      emit({ type: "resume:review-ready", persisted });
      return persisted;
    },

    async reconcileInFlight() {
      refuseWhileRunning("reconcile");
      return reconcileInFlight({ state, gateway, emit, afterStep: driver.runAfterStep });
    },

    async preflight() {
      refuseWhileRunning("run preflight");
      const active = state.require("run preflight");
      const reconcile = await reconcileInFlight({ state, gateway, emit, afterStep: driver.runAfterStep });
      const persistedAt = active.persistedAt ?? active.startedAt;

      let changed: ResumePreflightDiff["changes"] = [];
      let staleWarning: string | undefined;

      const live = state.get();
      if (hooks.onResume && live) {
        // Reconciled already, so `submitted` means genuinely out there.
        const flying = inFlightEntry(live.steps);

        const result = await hooks.onResume({
          ctx: live.ctx,
          snapshot: live.snapshot,
          pending: liveSteps(live.steps),
          persistedAt,
          ...(flying?.outcome.status === "submitted"
            ? { inFlight: { stepId: flying.stepId, hash: flying.outcome.hash } }
            : {}),
        });
        if (result) {
          if (result.ctx !== undefined) state.update({ ctx: result.ctx });
          if (result.pending !== undefined) {
            const replanned = state.get();
            if (replanned) state.update({ steps: replaceLive(replanned.steps, result.pending) });
          }
          changed = result.changes ?? [];
          staleWarning = result.staleWarning;
        }
      }

      const current = state.get();
      const diff: ResumePreflightDiff = {
        ageMs: now() - persistedAt,
        reconcile,
        completed: settledEntries(current?.steps ?? []),
        pending: liveEntries(current?.steps ?? []),
        changes: changed,
      };
      state.persist();
      emit({ type: "resume:preflight", diff, staleWarning });
      return diff;
    },

    getRun: () => state.get(),
    getStatus: () => state.get()?.status ?? "idle",
    listPersisted: () =>
      (store?.list<TSnapshot, TCtx>() ?? []).filter((persisted) => persisted.adapterId === adapterId),

    on: emitter.on,
    subscribe: changes.subscribe,
  };
}

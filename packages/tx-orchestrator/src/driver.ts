import type { Hash, TransactionReceipt } from "viem";

import { describeTxError, isFatalCause } from "./errors";
import type { ReceiptWatcher } from "./receiptWatcher";
import type { RunState } from "./runState";
import type { FlowScope } from "./scope";
import { currentEntry, liveSteps, replaceLive } from "./steps";
import type {
  FlowError,
  FlowHooks,
  FlowTx,
  LiveStepEntry,
  OrchestratorEvent,
  PauseReason,
  StepSummary,
  TxErrorCause,
  TxGateway,
  TxReplacement,
} from "./types";

/**
 * The step loop: one wallet prompt at a time, persisted before every event, and
 * stoppable only where stopping is safe.
 *
 * The phase helpers return `undefined` to mean "stopped, unwind". The stop is
 * already recorded and announced by then.
 */
export interface FlowDriver {
  /** Runs until the queue empties or the run reaches a resting state. */
  drive(): Promise<void>;
  /** Stops at the next safe checkpoint. Never aborts an open wallet prompt. */
  requestPause(): void;
  /** Runs `afterStep` for a step something other than the loop settled. */
  runAfterStep(completed: StepSummary, receipt: TransactionReceipt | null): Promise<void>;
  /** Kills the loop outright. */
  cancel(): void;
}

export function createFlowDriver<TSnapshot, TCtx>(deps: {
  state: RunState<TSnapshot, TCtx>;
  gateway: TxGateway;
  watcher: ReceiptWatcher;
  scope: FlowScope;
  /** This orchestrator's identity in a scope it may be sharing with others. */
  scopeOwner: string;
  hooks: FlowHooks<TSnapshot, TCtx>;
  emit: (event: OrchestratorEvent<TSnapshot, TCtx>) => void;
  classify: (error: unknown) => TxErrorCause;
}): FlowDriver {
  const { state, gateway, watcher, scope, scopeOwner, hooks, emit, classify } = deps;

  type Entry = LiveStepEntry<TSnapshot, TCtx>;

  /** Set by `requestPause()`; consumed at the next checkpoint. */
  let pauseRequested = false;
  /** Aborted by `cancel()`. */
  let cancelled: AbortController | null = null;

  // -------------------------------------------------------------------------
  // Resting states
  // -------------------------------------------------------------------------

  function settlePause(reason: PauseReason) {
    if (!state.get()) return;
    pauseRequested = false;
    state.transition({ status: "paused", reason });
    // The scope stays frozen: a paused run still owns the screen.
    state.persist();
    emit({ type: "flow:paused", reason });
  }

  function stop(args: {
    stepId: string;
    message: string;
    cause: TxErrorCause;
    reason: PauseReason;
    hash?: Hash;
    /**
     * Whether a broadcast transaction might still mine.
     */
    keepInFlight?: boolean;
  }) {
    if (!state.get()) return;
    const { stepId, message, cause, reason, hash, keepInFlight = false } = args;
    const error: FlowError = { stepId, message, cause, ...(hash ? { hash } : {}) };

    if (!keepInFlight) state.setOutcome(stepId, { status: "pending" });

    const fatal = isFatalCause(cause);
    state.transition(fatal ? { status: "failed", error } : { status: "paused", reason, error });

    pauseRequested = false;
    state.persist();
    emit({ type: "step:failed", stepId, error });

    emit(fatal ? { type: "flow:failed", error } : { type: "flow:paused", reason });
  }

  function complete() {
    const run = state.get();
    if (!run) return;
    state.transition({ status: "completed" });
    state.clearStorage(run.flowId);
    scope.unfreeze(scopeOwner);
    emit({ type: "flow:completed" });
  }

  // -------------------------------------------------------------------------
  // Phases of one step
  // -------------------------------------------------------------------------

  /** Work the chain may already have done, an allowance, a batch already sent. */
  async function askedToSkip(entry: Entry): Promise<boolean | undefined> {
    const run = state.get();
    if (!run) return undefined;
    if (!entry.step.canSkip) return false;
    try {
      return await entry.step.canSkip(run.ctx, run.snapshot);
    } catch (error) {
      stop({ stepId: entry.stepId, message: describeTxError(error), cause: classify(error), reason: "error" });
      return undefined;
    }
  }

  /**
   * The one wallet prompt, unless this step already has a transaction out
   * there, in which case it adopts that rather than signing for the same work
   * twice.
   */
  async function obtainHash(entry: Entry, signal: AbortSignal): Promise<Hash | undefined> {
    if (entry.outcome.status === "submitted") {
      // Re-announced so an event-driven stepper shows the hash it is waiting on.
      emit({ type: "step:submitted", stepId: entry.stepId, hash: entry.outcome.hash });
      return entry.outcome.hash;
    }

    state.setOutcome(entry.stepId, { status: "awaiting-signature" });
    state.persist();

    const live = state.get();
    if (!live) return undefined;

    let tx: FlowTx;
    try {
      tx = await entry.step.build(live.ctx, live.snapshot);
    } catch (error) {
      if (signal.aborted || !state.get()) return undefined;
      // A build never prompted, so this is never a rejection.
      stop({ stepId: entry.stepId, message: describeTxError(error), cause: classify(error), reason: "error" });
      return undefined;
    }
    if (signal.aborted || !state.get()) return undefined;

    let hash: Hash;
    try {
      hash = await gateway.sendTransaction(tx, { signal });
    } catch (error) {
      if (signal.aborted || !state.get()) return undefined;
      const cause = classify(error);
      stop({
        stepId: entry.stepId,
        message: describeTxError(error),
        cause,
        reason: cause === "rejected" ? "rejected" : "error",
      });
      return undefined;
    }
    if (signal.aborted || !state.get()) return undefined;

    state.setOutcome(entry.stepId, { status: "submitted", hash });
    state.persist();
    emit({ type: "step:submitted", stepId: entry.stepId, hash });
    return hash;
  }

  /**
   * Waits the transaction out and judges what came back. A speed-up is the same
   * intent and keeps going; a cancel, an unrelated replacement or a revert is
   * not, and stops the run.
   */
  async function settle(entry: Entry, hash: Hash, signal: AbortSignal): Promise<TransactionReceipt | undefined> {
    let replacement: TxReplacement | undefined;
    let receipt: TransactionReceipt;

    try {
      receipt = await watcher.wait({
        hash,
        signal,
        giveUp: () => pauseRequested,
        onReplaced: (seen) => {
          replacement = seen;
          state.setOutcome(entry.stepId, { status: "submitted", hash: seen.hash });
          state.persist();
          emit({ type: "step:replaced", stepId: entry.stepId, from: hash, to: seen.hash, reason: seen.reason });
        },
      });
    } catch (error) {
      if (signal.aborted || !state.get()) return undefined;
      if (pauseRequested) {
        settlePause("requested");
        return undefined;
      }
      const current = currentEntry(state.get()?.steps ?? []);
      stop({
        stepId: entry.stepId,
        message: describeTxError(error),
        cause: classify(error),
        reason: "error",
        hash: current?.outcome.status === "submitted" ? current.outcome.hash : undefined,
        // The wait failed, not the transaction. It may still mine.
        keepInFlight: true,
      });
      return undefined;
    }
    if (signal.aborted || !state.get()) return undefined;

    if (replacement && replacement.reason !== "repriced") {
      stop({
        stepId: entry.stepId,
        message:
          replacement.reason === "cancelled"
            ? "The transaction was cancelled in the wallet."
            : "Another transaction replaced this one.",
        cause: "cancelled",
        reason: "cancelled",
        hash: replacement.hash,
      });
      return undefined;
    }

    if (receipt.status === "reverted") {
      stop({
        stepId: entry.stepId,
        message: "The transaction reverted on chain.",
        cause: "reverted",
        reason: "error",
        hash: receipt.transactionHash,
      });
      return undefined;
    }

    return receipt;
  }

  /** `true` if the run should keep going after the adapter had its say. */
  async function applyAfterStep(
    completed: StepSummary,
    receipt: TransactionReceipt | null,
    signal: AbortSignal,
  ): Promise<boolean> {
    const run = state.get();
    if (!hooks.afterStep || !run) return true;

    let result;
    try {
      result = await hooks.afterStep({
        ctx: run.ctx,
        snapshot: run.snapshot,
        completed,
        receipt,
        pending: liveSteps(run.steps),
      });
    } catch (error) {
      // Classified, so a hiccup here pauses rather than fails.
      stop({
        stepId: completed.stepId,
        message: `After ${completed.label}: ${describeTxError(error)}`,
        cause: classify(error),
        reason: "error",
      });
      return false;
    }
    if (signal.aborted) return false;
    const live = state.get();
    if (!live) return false;
    if (!result) return true;

    try {
      if (result.ctx !== undefined) state.update({ ctx: result.ctx });
      // A skipped step reaches here with no receipt, and calling that one
      // "receipt" would be a lie about where the numbers came from.
      if (result.snapshotPatch !== undefined) {
        state.patchSnapshot(result.snapshotPatch, receipt ? "receipt" : "adapter");
      }
      if (result.pending !== undefined) {
        const withNewPlan = state.get();
        if (withNewPlan) state.update({ steps: replaceLive(withNewPlan.steps, result.pending) });
      }
    } catch (error) {
      // A bad plan must not reject the caller's promise mid-run.
      stop({ stepId: completed.stepId, message: describeTxError(error), cause: "unknown", reason: "error" });
      return false;
    }
    if (result.inform) emit({ type: "inform", message: result.inform });
    state.persist();

    if (result.pause) {
      settlePause("adapter");
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // The loop
  // -------------------------------------------------------------------------

  return {
    async drive() {
      const opened = state.get();
      if (!opened) return;

      pauseRequested = false;
      cancelled = new AbortController();
      const signal = cancelled.signal;
      scope.freeze(scopeOwner, `Transaction flow ${opened.flowId}`);
      state.transition({ status: "running" });
      state.persist();

      /** Trashing nulls the run, so both checks are needed after every await. */
      const gone = () => signal.aborted || state.get() === null;

      for (;;) {
        if (gone()) return;
        if (pauseRequested) return settlePause("requested");

        const run = state.get();
        if (!run) return;
        const entry = currentEntry(run.steps);
        if (!entry) break;

        const index = run.steps.findIndex((candidate) => candidate.stepId === entry.stepId);
        const total = run.steps.length;

        const skip = await askedToSkip(entry);
        if (skip === undefined || gone()) return;

        if (skip) {
          state.setOutcome(entry.stepId, { status: "skipped" });
          state.persist();
          emit({ type: "step:skipped", stepId: entry.stepId });
          const summary: StepSummary = { stepId: entry.stepId, label: entry.label, outcome: { status: "skipped" } };
          if (!(await applyAfterStep(summary, null, signal))) return;
          continue;
        }

        emit({ type: "step:pending", stepId: entry.stepId, label: entry.label, index, total });

        const hash = await obtainHash(entry, signal);
        if (!hash) return;

        // Safe checkpoint: the hash is on disk, so it is fine to stop watching.
        if (pauseRequested) return settlePause("requested");

        const receipt = await settle(entry, hash, signal);
        if (!receipt) return;

        const outcome = {
          status: "confirmed",
          hash: receipt.transactionHash,
          blockNumber: receipt.blockNumber,
        } as const;
        state.setOutcome(entry.stepId, outcome);
        state.persist();
        emit({ type: "step:confirmed", stepId: entry.stepId, hash: receipt.transactionHash, receipt });

        if (!(await applyAfterStep({ stepId: entry.stepId, label: entry.label, outcome }, receipt, signal))) return;
      }

      if (state.get()) complete();
    },

    runAfterStep: async (completed, receipt) =>
      void (await applyAfterStep(completed, receipt, new AbortController().signal)),

    requestPause() {
      const run = state.get();
      if (run?.status !== "running") return;
      pauseRequested = true;
      // Aborting an open prompt could hide a signature that still lands.
      if (currentEntry(run.steps)?.outcome.status === "submitted") watcher.abort();
    },

    cancel() {
      cancelled?.abort();
      watcher.abort();
      pauseRequested = false;
    },
  };
}

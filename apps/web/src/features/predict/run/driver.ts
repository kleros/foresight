"use client";

import {
  classifyTxError,
  createTxOrchestrator,
  currentEntry,
  settledEntries,
  type FlowError,
  type FlowRunStore,
  type OrchestratorRun,
  type TxErrorCause,
  type TxGateway,
} from "@foresight/tx-orchestrator";
import type { Address } from "viem";

import type { SwapQuoter } from "@/lib/swap/types";

import type { PredictDriver, PredictProgress, PredictStepRow } from "./types";
import { createPredictHooks, planPredict, type PredictDeps } from "../flow/plan";
import type { PredictCtx, PredictReader, PredictSnapshot } from "../flow/types";

/** Drives one prediction: the orchestrator's run, flattened into what the popup reads. */
export function createPredictRun(args: {
  gateway: TxGateway;
  reader: PredictReader;
  quoter: SwapQuoter;
  /** Keyed per session, so two sessions' runs cannot collide in storage. */
  flowId: string;
  ctx: () => PredictCtx;
  snapshot: () => PredictSnapshot;
  store?: FlowRunStore;
  slippageBps?: number;
  optionsPerBatch?: number;
  onComplete?: () => void;
  now?: () => number;
}): PredictDriver {
  const listeners = new Set<() => void>();
  const skipped: Address[] = [];
  let failure: PredictProgress["failure"];
  let retryFailed: (() => void) | undefined;
  let planned: PredictStepRow[] = [];
  let cached: PredictProgress;

  const deps: PredictDeps = {
    reader: args.reader,
    quoter: args.quoter,
    slippageBps: args.slippageBps,
    optionsPerBatch: args.optionsPerBatch,
    onSkip: (option) => {
      if (!skipped.includes(option.childMarket)) skipped.push(option.childMarket);
    },
  };

  const orchestrator = createTxOrchestrator<PredictSnapshot, PredictCtx>({
    adapterId: "predict-flow",
    gateway: args.gateway,
    hooks: createPredictHooks({ reader: args.reader }),
    store: args.store,
    now: args.now,
    // A build reads the chain and the indexer before it signs anything. Those failures are
    // transient and leave nothing behind, so they pause for a retry rather than ending the run.
    classifyError: (error) => (error instanceof Error && !("cause" in error) ? "rpc" : classifyTxError(error)),
  });

  const notify = () => {
    cached = buildProgress();
    for (const listener of listeners) listener();
  };

  function report(reason: TxErrorCause | undefined, retry?: () => void) {
    failure = reason === undefined ? undefined : { reason, retryable: Boolean(retry) };
    retryFailed = reason === undefined ? undefined : retry;
    notify();
  }

  const errorOf = (run: OrchestratorRun<PredictSnapshot, PredictCtx> | null): FlowError | undefined =>
    run?.status === "paused" || run?.status === "failed" ? run.error : undefined;

  function stage(): PredictProgress["stage"] {
    const run = orchestrator.getRun();
    if (!run) return "idle";

    switch (run.status) {
      case "completed":
        return "complete";
      case "running": {
        const status = currentEntry(run.steps)?.outcome.status;
        if (status === "submitted") return "confirming";
        // A predict step reads the pools and quotes every leg before the wallet opens.
        return status === "awaiting-signature" ? "signing" : "quoting";
      }
      default:
        return "halted";
    }
  }

  function buildProgress(): PredictProgress {
    const run = orchestrator.getRun();
    const settled = new Map(settledEntries(run?.steps ?? []).map((step) => [step.stepId, step]));
    const current = run?.status === "running" ? currentEntry(run.steps)?.stepId : undefined;
    const failedStep = errorOf(run)?.stepId;

    const steps = (run?.steps ?? []).map((entry): PredictStepRow => {
      const done = settled.get(entry.stepId);
      if (done) return { id: entry.stepId, label: entry.label, state: "success" };
      if (entry.stepId === current) return { id: entry.stepId, label: entry.label, state: "running" };
      if (entry.stepId === failedStep) return { id: entry.stepId, label: entry.label, state: "error" };
      return { id: entry.stepId, label: entry.label, state: "pending" };
    });

    const rows = steps.length > 0 ? steps : planned;
    const batchRows = rows.filter((row) => row.id.startsWith("predict-"));

    return {
      stage: stage(),
      steps: rows,
      skipped: [...skipped],
      batchesDone: batchRows.filter((row) => row.state === "success").length,
      batches: batchRows.length,
      failure,
    };
  }

  cached = buildProgress();

  orchestrator.subscribe(notify);
  orchestrator.on("flow:paused", () => {
    report(errorOf(orchestrator.getRun())?.cause, resumeRun);
  });
  orchestrator.on("flow:failed", (event) => report(event.error.cause));
  orchestrator.on("flow:completed", () => {
    args.onComplete?.();
    notify();
  });

  function detached(work: () => Promise<void>): () => void {
    const action = () => void work().catch((error: unknown) => report(classifyTxError(error), action));
    return action;
  }

  const resumeRun = detached(() => orchestrator.resume());

  /**
   * A run left behind by a closed tab. Its transactions may be on chain, so it is reconciled and
   * continued rather than thrown away — starting over would sign the deposit a second time.
   */
  const recoverRun = detached(async () => {
    const stored = args.store?.load<PredictSnapshot, PredictCtx>(args.flowId);
    if (!stored) return;

    const restored = orchestrator.restore({ flowId: args.flowId, steps: planPredict(stored.snapshot, deps) });
    if (!restored) return;

    planned = [];
    await orchestrator.reconcileInFlight();
    await orchestrator.resume();
  });

  const startRun = detached(async () => {
    report(undefined);
    skipped.length = 0;

    const snapshot = args.snapshot();
    const ctx = args.ctx();
    const steps = planPredict(snapshot, deps);
    // The rows exist before the run does, so the popup opens on the list rather than on nothing.
    planned = steps.map((step) => ({ id: step.id, label: step.label, state: "pending" }));
    notify();

    await orchestrator.start({ flowId: args.flowId, snapshot, ctx, steps });
  });

  return {
    start() {
      if (orchestrator.getStatus() !== "idle") return;
      // A stored run has steps that may already be on chain, and `start` would refuse anyway.
      if (args.store?.load(args.flowId)) {
        recoverRun();
        return;
      }
      startRun();
    },

    retry() {
      const again = retryFailed;
      // An option that would not route last time gets another go, so last time's list is dropped.
      skipped.length = 0;
      report(undefined);
      again?.();
    },

    reset() {
      orchestrator.trash(args.flowId);
      skipped.length = 0;
      planned = [];
      report(undefined);
    },

    dispose() {
      orchestrator.dispose();
    },

    getProgress: () => cached,

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

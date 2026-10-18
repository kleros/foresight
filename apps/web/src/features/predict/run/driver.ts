"use client";

import {
  classifyTxError,
  createTxOrchestrator,
  currentEntry,
  settledEntries,
  type FlowError,
  type FlowRunStore,
  type OrchestratorRun,
  type TxGateway,
} from "@foresight/tx-orchestrator";
import type { Address, Hash } from "viem";

import { chainText, OUT_OF_FUNDS, REVERTS } from "@/utils/txErrorText";

import type { SwapQuoter } from "@/lib/swap/types";

import type { PredictDriver, PredictFailureReason, PredictProgress, PredictStepRow } from "./types";
import {
  assertRoutes,
  createPredictHooks,
  NoRouteError,
  planPredict,
  PredictConfigError,
  QuoteFailedError,
  STEP_ID,
  tradeWalletShare,
  type PredictDeps,
} from "../flow/plan";
import type { PredictCtx, PredictReader, PredictRequest, PredictSnapshot } from "../flow/types";

/** The trade wallet holds less than the share of the prediction it was shown to cover. */
class TradeWalletShortError extends Error {}

/** Why a saved run cannot be continued from the connected wallet, if it cannot. */
function foreign(saved: PredictCtx, current: PredictCtx): "wrong-wallet" | "wrong-chain" | undefined {
  if (String(saved.owner).toLowerCase() !== current.owner.toLowerCase()) return "wrong-wallet";
  if (saved.chainId !== current.chainId) return "wrong-chain";
  return undefined;
}

/** Drives one prediction: the orchestrator's run, flattened into what the popup reads. */
export function createPredictRun(args: {
  gateway: TxGateway;
  reader: PredictReader;
  quoter: SwapQuoter;
  /** Keyed per chain, owner and session, so no two runs share a stored record. */
  flowId: string;
  ctx: () => PredictCtx;
  snapshot: () => PredictRequest;
  store?: FlowRunStore;
  slippageBps?: number;
  optionsPerBatch?: number;
  onComplete?: () => void;
  now?: () => number;
}): PredictDriver {
  const listeners = new Set<() => void>();
  /** Options left out by each batch not yet settled, by step id; a settled batch's are kept in the run's snapshot. */
  const skipping = new Map<string, Address[]>();
  let failure: PredictProgress["failure"];
  let retryFailed: (() => void) | undefined;
  let planned: PredictStepRow[] = [];
  /** Set while the routes are checked, before the orchestrator has a run; reset and dispose clear it. */
  let checking: object | undefined;
  /** The reason a step failed with, which the orchestrator's own causes cannot carry. */
  let buildFailure: "no-route" | "quote" | "funds" | undefined;
  /** Set while a sent transaction's outcome is read from the chain; the run itself stays stopped meanwhile. */
  let reconciling = false;
  /** Set once a stored run is restored, until it is thrown away: the popup shows its snapshot, not the form. */
  let recovered = false;
  /** A restored run, reconciled, waiting for the visitor to resume it. */
  let reviewing = false;
  /** Set once this run sends a transaction that moves money; a failed step put back to pending does not clear it. */
  let moneyMoved = false;
  let cached: PredictProgress;

  const deps: PredictDeps = {
    reader: args.reader,
    quoter: args.quoter,
    slippageBps: args.slippageBps,
    optionsPerBatch: args.optionsPerBatch,
    onSkip: (option, _reason, stepId) => {
      const left = skipping.get(stepId) ?? [];
      if (!left.includes(option.childMarket)) skipping.set(stepId, [...left, option.childMarket]);
    },
  };

  const orchestrator = createTxOrchestrator<PredictSnapshot, PredictCtx>({
    adapterId: "predict-flow",
    gateway: args.gateway,
    hooks: createPredictHooks({
      reader: args.reader,
      takeSkips: (stepId) => {
        const left = skipping.get(stepId) ?? [];
        skipping.delete(stepId);
        return left;
      },
    }),
    store: args.store,
    now: args.now,
    // A build reads the chain and the indexer before it signs anything. Those failures are
    // transient and leave nothing behind, so they pause for a retry rather than ending the run.
    // A missing route is fatal to the orchestrator and a failed quote pauses it.
    classifyError: (error) => {
      buildFailure =
        error instanceof NoRouteError ? "no-route" : error instanceof QuoteFailedError ? "quote" : undefined;
      if (buildFailure === "quote") return "rpc";
      if (buildFailure === "no-route" || error instanceof PredictConfigError) return "unknown";
      if (error instanceof Error && !("cause" in error)) return "rpc";
      const cause = classifyTxError(error);
      if (cause === "rejected") return cause;
      const text = chainText(error);
      // a top-up lets the same transaction through, so the run pauses rather than ends
      if (OUT_OF_FUNDS.test(text)) {
        buildFailure = "funds";
        return "rpc";
      }
      return REVERTS.test(text) ? "reverted" : cause;
    },
  });

  const notify = () => {
    cached = buildProgress();
    for (const listener of listeners) listener();
  };

  function report(reason: PredictFailureReason | undefined, retry?: () => void) {
    failure = reason === undefined ? undefined : { reason, retryable: Boolean(retry) };
    retryFailed = reason === undefined ? undefined : retry;
    notify();
  }

  const errorOf = (run: OrchestratorRun<PredictSnapshot, PredictCtx> | null): FlowError | undefined =>
    run?.status === "paused" || run?.status === "failed" ? run.error : undefined;

  function pendingHashOf(run: OrchestratorRun<PredictSnapshot, PredictCtx> | null): Hash | undefined {
    const outcome = run && run.status !== "running" ? currentEntry(run.steps)?.outcome : undefined;
    return outcome?.status === "submitted" ? outcome.hash : undefined;
  }

  function stage(): PredictProgress["stage"] {
    const run = orchestrator.getRun();
    if (!run) return failure ? "halted" : checking ? "quoting" : "idle";
    if (reconciling && !failure) return "confirming";
    if (reviewing && !failure) return "review";

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

    const pendingHash = pendingHashOf(run);
    const rows = steps.length > 0 ? steps : planned;
    const batchRows = rows.filter((row) => row.id.startsWith("predict-"));

    const settledSkips = run?.snapshot.skipped ?? [];
    const skipped = [...settledSkips, ...[...skipping.values()].flat()];

    return {
      stage: stage(),
      steps: rows,
      skipped: skipped.filter((market, index) => skipped.indexOf(market) === index),
      batchesDone: batchRows.filter((row) => row.state === "success").length,
      batches: batchRows.length,
      failure,
      ...(pendingHash ? { pendingHash } : {}),
      ...(moneyMoved ? { moneyMoved: true as const } : {}),
      ...(recovered && run ? { recovered: run.snapshot } : {}),
    };
  }

  cached = buildProgress();

  orchestrator.subscribe(notify);
  orchestrator.on("step:submitted", (event) => {
    if (event.stepId !== STEP_ID.createExecutor) moneyMoved = true;
  });
  orchestrator.on("flow:paused", () => {
    const run = orchestrator.getRun();
    const reason = buildFailure ?? errorOf(run)?.cause;
    buildFailure = undefined;
    report(reason, pendingHashOf(run) ? reconcileRun : resumeRun);
  });
  orchestrator.on("flow:failed", (event) => {
    const reason = buildFailure ?? event.error.cause;
    buildFailure = undefined;
    // A failed wait keeps its hash, so the chain is asked how it ended before anything is signed again.
    if (pendingHashOf(orchestrator.getRun())) report(reason, reconcileRun);
    // A reverted batch is rebuilt from fresh quotes; the steps before it stay settled.
    else if (reason === "reverted" && event.error.stepId.startsWith("predict-")) report(reason, resumeRun);
    else report(reason);
  });
  orchestrator.on("flow:completed", () => {
    args.onComplete?.();
    notify();
  });

  function detached(work: () => Promise<void>): () => void {
    const action = () =>
      void work().catch((error: unknown) => {
        if (error instanceof NoRouteError) report("no-route");
        else if (error instanceof QuoteFailedError) report("quote", action);
        else if (error instanceof TradeWalletShortError) report("balance");
        else if (error instanceof PredictConfigError) report("unknown");
        else report(classifyTxError(error), action);
      });
    return action;
  }

  const resumeRun = detached(() => orchestrator.resume());

  /** Settles a sent transaction whose receipt was never seen, then carries on only if it mined or may still. */
  const reconcileRun = detached(async () => {
    reconciling = true;
    notify();
    const found = await orchestrator.reconcileInFlight().finally(() => {
      reconciling = false;
    });
    // A revert is reported through `flow:failed`; a dropped transaction is rebuilt only on the next press.
    if (found.outcome === "reverted") return;
    if (found.outcome === "dropped") {
      report(errorOf(orchestrator.getRun())?.cause ?? "unknown", resumeRun);
      return;
    }
    await orchestrator.resume();
  });

  /**
   * A run left behind by a closed tab. Its transactions may be on chain, so it is restored and
   * reconciled rather than thrown away, then held for review: nothing is signed until `resume`.
   */
  const recoverRun = detached(async () => {
    const stored = args.store?.load<PredictSnapshot, PredictCtx>(args.flowId);
    if (!stored) return;
    // Only the owner who saved a run, on the chain it was saved on, may sign the rest of it.
    const mismatch = foreign(stored.ctx, args.ctx());
    if (mismatch) {
      report(mismatch);
      return;
    }

    const steps = planPredict(stored.snapshot, deps);
    const restored = orchestrator.restore({ flowId: args.flowId, steps });
    if (!restored) return;

    planned = [];
    recovered = true;
    reconciling = true;
    notify();
    const found = await orchestrator.reconcileInFlight().finally(() => {
      reconciling = false;
    });
    if (found.outcome === "reverted") return;
    // A deposit signed as the tab died left no hash, and the balance cannot show it until it mines.
    if (found.outcome === "unknown" && found.stepId === STEP_ID.deposit) {
      const deposit = steps.find((step) => step.id === STEP_ID.deposit);
      if (!(await deposit?.canSkip?.(stored.ctx, stored.snapshot))) {
        report("deposit-unconfirmed", resumeRun);
        return;
      }
    }
    reviewing = true;
    notify();
  });

  /** Pins the trade wallet's balance before anything is signed, and checks a route exists. */
  async function prepare(ctx: PredictCtx, requested: PredictRequest): Promise<PredictSnapshot> {
    const collateralAtStart = await args.reader.collateralBalance(ctx.executor);
    if (collateralAtStart < tradeWalletShare(requested)) throw new TradeWalletShortError();
    const snapshot = { ...requested, collateralAtStart };
    await assertRoutes(ctx, snapshot, deps);
    return snapshot;
  }

  const startRun = detached(async () => {
    report(undefined);
    skipping.clear();
    moneyMoved = false;

    const requested = args.snapshot();
    const ctx = args.ctx();
    const steps = planPredict(requested, deps);
    // The rows exist before the run does, so the popup opens on the list rather than on nothing.
    planned = steps.map((step) => ({ id: step.id, label: step.label, state: "pending" }));
    const check = {};
    checking = check;
    notify();

    const checked = await prepare(ctx, requested).then(
      (snapshot) => ({ snapshot }),
      (error: unknown) => ({ error }),
    );
    if (checking !== check) return;
    checking = undefined;
    if ("error" in checked) throw checked.error;
    await orchestrator.start({ flowId: args.flowId, snapshot: checked.snapshot, ctx, steps });
  });

  return {
    start() {
      if (checking || orchestrator.getStatus() !== "idle") return;
      // A stored run has steps that may already be on chain, and `start` would refuse anyway.
      if (args.store?.load(args.flowId)) {
        recoverRun();
        return;
      }
      startRun();
    },

    recover() {
      if (checking || orchestrator.getStatus() !== "idle") return;
      recoverRun();
    },

    resume() {
      if (!reviewing) return;
      reviewing = false;
      // The chain is read again: a transaction pending at review may have mined or dropped since.
      reconcileRun();
    },

    retry() {
      const again = retryFailed;
      // A batch that is rebuilt gives its options another go; a sent one's skips stand until its receipt is read.
      const run = orchestrator.getRun();
      const sent = run && pendingHashOf(run) ? currentEntry(run.steps)?.stepId : undefined;
      for (const stepId of [...skipping.keys()]) if (stepId !== sent) skipping.delete(stepId);
      report(undefined);
      again?.();
    },

    reset() {
      checking = undefined;
      const stored = args.store?.load<PredictSnapshot, PredictCtx>(args.flowId);
      if (!stored || !foreign(stored.ctx, args.ctx())) orchestrator.trash(args.flowId);
      recovered = false;
      reviewing = false;
      moneyMoved = false;
      buildFailure = undefined;
      skipping.clear();
      planned = [];
      report(undefined);
    },

    dispose() {
      checking = undefined;
      orchestrator.dispose();
    },

    getProgress: () => cached,

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

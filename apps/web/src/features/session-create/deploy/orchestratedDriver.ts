import {
  classifyTxError,
  createTxOrchestrator,
  currentEntry,
  describeTxError,
  settledEntries,
  type FlowError,
  type FlowRunStore,
  type FlowScope,
  type OrchestratorRun,
  type TxGateway,
} from "@foresight/tx-orchestrator";

import type { MetadataUploader } from "@/lib/atlas/types";

import { IndexerNotReadyError } from "./sessionLookup";
import type { DeployFailure, DeployResume, MarketProgress, SessionDeployDriver, SessionDeployProgress } from "./types";
import { batchCount, CHILD_BATCH_SIZE, deployMode } from "../flow/params";
import { batchNumberOf, createSessionCreateHooks, planSessionDeploy, STEP_ID, witnessSession } from "../flow/plan";
import { publishSessionMetadata, type ImageSource } from "../flow/publish";
import type {
  SessionDeployCtx,
  SessionDeployInput,
  SessionDeploySnapshot,
  SessionLookup,
  SessionMetadataInput,
} from "../flow/types";

function errorOf(run: OrchestratorRun<SessionDeploySnapshot, SessionDeployCtx> | null): FlowError | undefined {
  return run?.status === "paused" || run?.status === "failed" ? run.error : undefined;
}

export type DeploySources = {
  deploy: SessionDeployInput;
  metadata: Omit<SessionMetadataInput, "heroImage" | "icon">;
  images: { hero: ImageSource; icon?: ImageSource };
};

export function createOrchestratedDeploy(args: {
  gateway: TxGateway;
  uploader: MetadataUploader;
  ctx: () => SessionDeployCtx;
  /**
   * The storage key for this run.
   */
  flowId: string;
  outcomeCount: number;
  /** Called only at `start()`, so the run locks the draft as it stands then. */
  sources: () => DeploySources;
  /** Without one, a closed tab loses a run whose parent is already paid for. */
  store?: FlowRunStore;
  /** Shared so the rest of the app can tell a transaction owns the screen. */
  scope?: FlowScope;
  /** Milliseconds, for the plan's staleness check. */
  now?: () => number;
  /**
   * Seconds, off the chain: `startedAt` is matched against block timestamps.
   * A browser clock ahead of the chain excludes the session the run opened.
   */
  chainTime?: () => Promise<number>;
  /** Without one, the session-opening steps carry no skip test. */
  findSession?: SessionLookup;
  /** Without one, the screen calls a deploy done before the session page can render. */
  awaitIndexed?: (snapshot: SessionDeploySnapshot) => Promise<void>;
}): SessionDeployDriver {
  const now = args.now ?? (() => Date.now());
  const chainTime = args.chainTime ?? (() => Promise.resolve(Math.floor(now() / 1000)));
  const listeners = new Set<() => void>();

  /**
   * `useSyncExternalStore` compares snapshots by identity and loops forever if
   * a fresh object comes back every read, so progress is rebuilt on change and
   * handed out unchanged in between.
   */
  let cached: SessionDeployProgress;

  const notify = () => {
    cached = buildProgress();
    for (const listener of listeners) listener();
  };

  let uploadPhase: "idle" | "uploading" | "verifying" | "done" = "idle";
  let failure: DeployFailure | undefined;
  /** What "Try again" does about the failure on screen. */
  let retryFailed: (() => void) | undefined;
  let resume: DeployResume | undefined;
  let indexing = false;
  let outcomeCount = args.outcomeCount;
  /** Transactions the indexer witnessed, for markets this driver never saw confirm. */
  let witnessed: { parent?: string; children: (string | undefined)[] } = { children: [] };

  const hooks = createSessionCreateHooks({ findSession: args.findSession });

  function report(failed: { message: string; hash?: string } | undefined, retry?: () => void) {
    failure = failed ? { message: failed.message, retryable: Boolean(retry), hash: failed.hash } : undefined;
    retryFailed = failed ? retry : undefined;
    notify();
  }

  function detached(work: () => Promise<void>): () => void {
    const action = () => void work().catch((error: unknown) => report({ message: describeTxError(error) }, action));
    return action;
  }

  const orchestrator = createTxOrchestrator<SessionDeploySnapshot, SessionDeployCtx>({
    adapterId: "session-create-flow",
    gateway: args.gateway,
    hooks,
    store: args.store,
    scope: args.scope,
    now,
    classifyError: (error) => (error instanceof IndexerNotReadyError ? "rpc" : classifyTxError(error)),
  });

  const startRun = detached(() => run());
  const recoverStoredRun = detached(() => recoverRun());
  const resumeRun = detached(() => orchestrator.resume());

  orchestrator.subscribe(notify);
  orchestrator.on("flow:completed", () => {
    const probe = args.awaitIndexed;
    const snapshot = orchestrator.getRun()?.snapshot;
    if (!probe || !snapshot) return;

    // On chain, but the session page cannot render until the subgraph sees it.
    indexing = true;
    notify();
    // A probe that gives up says nothing about the deploy, which is done. The
    // screen moves on to `complete` either way.
    void probe(snapshot)
      .catch(() => {})
      .finally(() => {
        indexing = false;
        notify();
      });
  });
  orchestrator.on("flow:paused", () => {
    // A pause someone asked for carries no error, so it clears the last one.
    report(errorOf(orchestrator.getRun()), resumeRun);
  });
  orchestrator.on("flow:failed", (event) => {
    // Fatal: nothing to try again, only start over.
    report(event.error);
  });

  function snapshotNow(): SessionDeploySnapshot | undefined {
    return orchestrator.getRun()?.snapshot;
  }

  function stage(): SessionDeployProgress["stage"] {
    if (uploadPhase === "uploading") return "uploading";
    if (uploadPhase === "verifying") return "verifying";

    const run = orchestrator.getRun();
    if (!run) return uploadPhase === "done" ? "signing" : "idle";

    switch (run.status) {
      case "completed":
        return indexing ? "indexing" : "complete";
      case "running":
        return currentEntry(run.steps)?.outcome.status === "submitted" ? "confirming" : "signing";
      case "paused":
      case "failed":
        return "halted";
      default:
        return "idle";
    }
  }

  /** How far one planned step has got, and the transaction that took it there. */
  function stepProgress(stepId: string): MarketProgress {
    const run = orchestrator.getRun();
    const settled = settledEntries(run?.steps ?? []).find((step) => step.stepId === stepId);
    if (settled) {
      // A step skipped because the chain already had its work carries no hash.
      return { state: "success", hash: settled.outcome.status === "confirmed" ? settled.outcome.hash : undefined };
    }
    if (run?.status === "running" && currentEntry(run.steps)?.stepId === stepId) return { state: "running" };
    if (failure && errorOf(run)?.stepId === stepId) return { state: "error" };
    return { state: "pending" };
  }

  /** Where a batch's branches start, once the snapshot holds every one of them. */
  function landedBatchStart(index: number, childMarkets: SessionDeploySnapshot["childMarkets"]): number | null {
    const first = index * CHILD_BATCH_SIZE;
    const last = Math.min(first + CHILD_BATCH_SIZE, outcomeCount);
    if (last <= first) return null;
    for (let i = first; i < last; i += 1) if (!childMarkets[i]) return null;
    return first;
  }

  /**
   * A batch's row. Its own step outcome first; failing that, every branch it
   * creates existing, which is all a batch this driver never ran leaves behind.
   */
  function batchProgress(index: number, childMarkets: SessionDeploySnapshot["childMarkets"]): MarketProgress {
    const step = stepProgress(STEP_ID.batch(index + 1));
    if (step.state === "success") return step;

    const first = landedBatchStart(index, childMarkets);
    return first === null ? step : { state: "success", hash: witnessed.children[first] };
  }

  /** Per-market rows, derived from what the run has actually confirmed. */
  function markets(
    parent: MarketProgress,
    batchSteps: MarketProgress[],
  ): { parent: MarketProgress; children: MarketProgress[] } {
    const snapshot = snapshotNow();

    const children = Array.from({ length: outcomeCount }, (_, index): MarketProgress => {
      // Atomic puts every child in the parent's transaction; phased gives each
      // batch its own, so a child's row is its batch's row.
      const step = batchSteps[Math.floor(index / CHILD_BATCH_SIZE)] ?? parent;
      // The address is what proves a child exists; a recovered run has one for a
      // step this driver never ran.
      if (snapshot?.childMarkets[index]) return { state: "success", hash: step.hash };
      return step;
    });

    return { parent, children };
  }

  function buildProgress(): SessionDeployProgress {
    const snapshot = snapshotNow();
    const batches = batchCount(outcomeCount);
    // The snapshot's mode is the one the plan was built from. Before a run there
    // is none, so the draft's branch count stands in.
    const mode = snapshot?.mode ?? deployMode(outcomeCount);

    const parentStep = stepProgress(mode === "atomic" ? STEP_ID.atomic : STEP_ID.parent);
    // The address is what proves the decision market exists, whoever put it there.
    const parent: MarketProgress = snapshot?.parentMarket
      ? { state: "success", hash: parentStep.hash ?? witnessed.parent }
      : parentStep;

    const batchSteps =
      mode === "atomic"
        ? []
        : Array.from({ length: batches }, (_, i) => batchProgress(i, snapshot?.childMarkets ?? []));
    const batchesDone = batchSteps.filter((step) => step.state === "success").length;

    return {
      stage: stage(),
      mode,
      batch: Math.min(batchesDone + 1, batches),
      batches,
      ...markets(parent, batchSteps),
      batchSteps,
      failure,
      resume,
      metadataUri: snapshot?.metadataUri,
      images: snapshot?.images,
      parentMarket: snapshot?.parentMarket,
    };
  }

  cached = buildProgress();

  async function run() {
    report(undefined);

    let snapshot: SessionDeploySnapshot;
    let ctx: SessionDeployCtx;
    try {
      // Reading the draft and the wallet can refuse, so both are inside the try
      // with the upload: everything before the first signature fails the same
      // way, and nothing is uploaded for a deploy that cannot be signed.
      const sources = args.sources();
      ctx = args.ctx();
      outcomeCount = sources.deploy.children.length;

      // Claimed before the first await, or a second press slips in behind it.
      uploadPhase = "uploading";
      notify();

      const startedAt = await chainTime();
      const published = await publishSessionMetadata({
        uploader: args.uploader,
        images: sources.images,
        metadata: sources.metadata,
        onProgress: (phase) => {
          uploadPhase = phase === "verifying" ? "verifying" : "uploading";
          notify();
        },
      });

      snapshot = {
        deploy: sources.deploy,
        metadata: { ...sources.metadata, heroImage: "", icon: undefined },
        metadataUri: published.uri,
        images: { hero: published.document.session.heroImage, icon: published.document.session.icon },
        childMarkets: [],
        mode: deployMode(sources.deploy.children.length),
        startedAt,
      };
    } catch (error) {
      uploadPhase = "idle";
      // Nothing has been signed, so this is always safe to try again.
      report({ message: describeTxError(error) }, startRun);
      return;
    }

    uploadPhase = "done";
    notify();

    try {
      await orchestrator.start({
        flowId: args.flowId,
        snapshot,
        ctx,
        steps: planSessionDeploy(snapshot, { now: now(), findSession: args.findSession }),
      });
    } catch (error) {
      // Planning can refuse a stale draft, before anything is signed.
      uploadPhase = "idle";
      report({ message: describeTxError(error) }, startRun);
    }
  }

  async function recoverRun() {
    if (!args.store || orchestrator.getStatus() !== "idle") return;

    const stored = args.store.load<SessionDeploySnapshot, SessionDeployCtx>(args.flowId);
    if (!stored) return;

    let restored;
    try {
      restored = orchestrator.restore({
        flowId: args.flowId,
        steps: planSessionDeploy(stored.snapshot, { now: now(), findSession: args.findSession }),
      });
    } catch (error) {
      report({ message: describeTxError(error) });
      return;
    }
    if (!restored) return;

    outcomeCount = restored.snapshot.deploy.children.length;

    let reconciled;
    try {
      reconciled = await orchestrator.reconcileInFlight();
    } catch (error) {
      // Restored but unchecked, and resuming a run whose transaction nobody has
      // asked the chain about could pay for work already done. Letting go of it
      // leaves the record in storage for the next attempt.
      orchestrator.dispose();
      report({ message: describeTxError(error) }, recoverStoredRun);
      return;
    }

    // Let go of, trashed or reset while the chain was being asked: whatever came
    // back describes a run this driver no longer holds.
    if (!orchestrator.getRun()) return;

    const current = currentEntry(orchestrator.getRun()?.steps ?? []);
    const stepId = reconciled.stepId ?? current?.stepId ?? STEP_ID.atomic;

    resume = {
      stepId,
      label: current?.label ?? "the deploy",
      outcome: reconciled.outcome,
      // Every other outcome is the chain having answered.
      canSelfCheck: reconciled.outcome === "unknown" ? Boolean(reconciled.canSelfCheck) : true,
      hash: reconciled.hash,
    };
    notify();

    await witnessRun();
  }

  async function witnessRun() {
    const { findSession } = args;
    const run = orchestrator.getRun();
    if (!findSession || !run?.snapshot.metadataUri) return;

    // An indexer that will not answer leaves the run as reconcile left it.
    const seen = await witnessSession(findSession, run.ctx, run.snapshot).catch(() => null);
    // Continued, let go of or trashed while the indexer was being asked: the
    // answer describes a run this driver no longer holds.
    if (!seen || orchestrator.getRun() !== run) return;

    witnessed = {
      parent: seen.found.transactionHash,
      children: seen.found.childMarkets.reduce<(string | undefined)[]>((all, child) => {
        all[child.outcomeIndex] = child.transactionHash;
        return all;
      }, []),
    };
    orchestrator.updateSnapshot(seen.snapshot, { source: "adapter" });

    // A step that closed over the wallet has no hash of its own, and the offer
    // to continue is read against the rows below, which now carry the indexer's.
    if (resume && !resume.hash) {
      resume = { ...resume, hash: witnessedHash(resume.stepId, seen.snapshot) };
    }
    notify();
  }

  /** The transaction the indexer holds for a step's work, once it holds all of it. */
  function witnessedHash(stepId: string, snapshot: SessionDeploySnapshot): string | undefined {
    if (stepId === STEP_ID.parent || stepId === STEP_ID.atomic) return witnessed.parent;

    const batch = batchNumberOf(stepId);
    const first = batch === null ? null : landedBatchStart(batch - 1, snapshot.childMarkets);
    return first === null ? undefined : witnessed.children[first];
  }

  return {
    start() {
      if (uploadPhase !== "idle" || orchestrator.getStatus() !== "idle") return;
      startRun();
    },

    recover() {
      recoverStoredRun();
    },

    continueRecovered() {
      if (!resume) return;
      resume = undefined;
      uploadPhase = "done";
      notify();
      resumeRun();
    },

    retry() {
      const again = retryFailed;
      report(undefined);
      again?.();
    },

    reset() {
      orchestrator.trash(args.flowId);
      uploadPhase = "idle";
      indexing = false;
      resume = undefined;
      witnessed = { children: [] };
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

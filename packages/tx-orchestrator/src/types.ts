import type { Address, Hash, Hex, TransactionReceipt } from "viem";

/** The current schema of a persisted run. Bump when a stored shape changes meaning. */
export const FLOW_RUN_SCHEMA_VERSION = 1;

/** Past this a run is auto-trashed rather than resumed. */
export const DEFAULT_RUN_TTL_MS = 72 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Chain port
// ---------------------------------------------------------------------------

/** A transaction to sign, built by a domain adapter from its own context. */
export type FlowTx = {
  to: Address;
  data?: Hex;
  value?: bigint;
  chainId?: number;
  gas?: bigint;
};

/**
 * What a wallet did to an already-submitted transaction.
 *
 * - `repriced`: same intent at a higher fee, so the step still executes.
 * - `cancelled`: a zero-value self-send took the nonce. It did not execute.
 * - `replaced`: something unrelated took the nonce. It did not execute.
 */
export type TxReplacementReason = "repriced" | "cancelled" | "replaced";

export type TxReplacement = { reason: TxReplacementReason; hash: Hash };

/**
 * Everything the orchestrator needs from a chain, and nothing more, so the
 * wallet edge cases are drivable from a test without a node. `apps/web` binds
 * this to wagmi/viem.
 */
export interface TxGateway {
  /** Prompts the wallet. Rejects with a user-rejection error if declined. */
  sendTransaction(tx: FlowTx, opts?: { signal?: AbortSignal }): Promise<Hash>;

  waitForReceipt(args: {
    hash: Hash;
    confirmations?: number;
    signal?: AbortSignal;
    onReplaced?: (replacement: TxReplacement) => void;
  }): Promise<TransactionReceipt>;

  /** Receipt if mined, `null` if not. Used to reconcile a run on load. */
  getReceipt(hash: Hash): Promise<TransactionReceipt | null>;

  /**
   * Whether the node still knows this hash at all. Separates "still in the
   * mempool" from "dropped", which need opposite responses.
   */
  isKnown(hash: Hash): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type TxStep<TSnapshot, TCtx> = {
  id: string;
  label: string;
  /** Checked immediately before building, e.g. an allowance already granted. */
  canSkip?: (ctx: TCtx, snapshot: Readonly<TSnapshot>) => Promise<boolean> | boolean;
  /**
   * Built fresh on every attempt, so a retry after a rejection picks up the
   * current nonce, gas and any snapshot the previous step patched.
   */
  build: (ctx: TCtx, snapshot: Readonly<TSnapshot>) => Promise<FlowTx> | FlowTx;
};

/** Where a step got to. There is no failed outcome: a failed step is `pending` again. */
export type StepOutcome =
  /** Not started, or stopped and awaiting another go. */
  | { status: "pending" }
  /** The wallet is open. Nothing was broadcast, so there is nothing to reconcile. */
  | { status: "awaiting-signature" }
  /** Broadcast. The hash is on disk before this is announced. */
  | { status: "submitted"; hash: Hash }
  | { status: "confirmed"; hash: Hash; blockNumber: bigint }
  | { status: "skipped" };

export type StepStatus = StepOutcome["status"];

/** Done with, and never run again. */
export type SettledOutcome = Extract<StepOutcome, { status: "confirmed" | "skipped" }>;
/** Still owed work, so it still needs something to build it. */
export type LiveOutcome = Exclude<StepOutcome, SettledOutcome>;

/** A step and where it got to. Only one that might still run carries a builder. */
export type StepEntry<TSnapshot, TCtx> =
  | { stepId: string; label: string; outcome: SettledOutcome }
  | { stepId: string; label: string; outcome: LiveOutcome; step: TxStep<TSnapshot, TCtx> };

export type LiveStepEntry<TSnapshot, TCtx> = Extract<StepEntry<TSnapshot, TCtx>, { outcome: LiveOutcome }>;

/** A step with a wallet open or a transaction on chain. */
export type InFlightStepEntry<TSnapshot, TCtx> = Omit<LiveStepEntry<TSnapshot, TCtx>, "outcome"> & {
  outcome: Extract<StepOutcome, { status: "awaiting-signature" | "submitted" }>;
};

/** A step without its builder: what storage keeps and what a review screen reads. */
export type StepSummary = { stepId: string; label: string; outcome: StepOutcome };

// ---------------------------------------------------------------------------
// Run state
// ---------------------------------------------------------------------------

/** What a run can be. */
export type RunStatus = "running" | "paused" | "completed" | "failed";

/** A run's status, plus `idle` for "there is no run at all". */
export type FlowStatus = RunStatus | "idle";

export type PauseReason =
  /** The wallet prompt was declined or dismissed. */
  | "rejected"
  /** A build, send or receipt call failed, or the transaction reverted. */
  | "error"
  /** The wallet replaced the transaction with one that does not do the job. */
  | "cancelled"
  /** `pause()` was called; the run stopped at its next safe checkpoint. */
  | "requested"
  /** The tab went away mid-run. Nobody paused it; it was cut off. */
  | "interrupted"
  /** An adapter stopped the run itself, e.g. a quote moved beyond tolerance. */
  | "adapter";

export type FlowError = {
  stepId: string;
  message: string;
  cause: TxErrorCause;
  /** The transaction that failed, when there was one */
  hash?: Hash;
};

/** Everything a run has regardless of what it is doing. */
export type RunFacts<TSnapshot, TCtx> = {
  flowId: string;
  adapterId: string;
  snapshot: TSnapshot;
  ctx: TCtx;
  steps: StepEntry<TSnapshot, TCtx>[];
  startedAt: number;
  /** Set on a restored run: when it was last written to storage. Drives staleness. */
  persistedAt?: number;
};

/** A run, discriminated by what it is doing. */
export type OrchestratorRun<TSnapshot, TCtx> = RunFacts<TSnapshot, TCtx> & RunPhase;

export type RunPhase =
  | { status: "running" }
  /** `error` is absent when the pause was asked for rather than caused. */
  | { status: "paused"; reason: PauseReason; error?: FlowError }
  | { status: "failed"; error: FlowError }
  | { status: "completed" };

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** A completed run is cleared rather than stored, so it has no persisted phase. */
export type PersistedPhase = Extract<RunPhase, { status: "running" | "paused" | "failed" }>;

/**
 * The store stamps version and timing, so a caller cannot backdate a run.
 * An intersection, not `Omit`, which would flatten the phase union.
 */
export type PersistedFlowRunInput<TSnapshot, TCtx> = {
  flowId: string;
  adapterId: string;
  snapshot: TSnapshot;
  ctx: TCtx;
  steps: StepSummary[];
} & PersistedPhase;

export type PersistedFlowRun<TSnapshot, TCtx> = PersistedFlowRunInput<TSnapshot, TCtx> & {
  version: number;
  persistedAt: number;
  expiresAt: number;
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type TxErrorCause =
  /** The person said no to a prompt. Never retry without asking again. */
  | "rejected"
  /** The wallet spent the nonce on something that does not do the job. */
  | "cancelled"
  /** It mined and reverted. Retrying the same transaction will revert again. */
  | "reverted"
  /** RPC hiccup, timeout, rate limit. Safe to retry the same read. */
  | "rpc"
  /** Unrecognised. Stop and ask rather than retry blind. */
  | "unknown";

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

/** What reconciling a persisted in-flight transaction found on chain. */
export type ReconcileOutcome =
  /** It mined successfully while the tab was away; the step is done. */
  | "confirmed"
  /** It mined and reverted. */
  | "reverted"
  /** Still in the mempool. */
  | "pending"
  /** The node has never heard of it, dropped after broadcast. */
  | "dropped"
  /**
   * A wallet prompt was open when the tab went away. No hash was ever recorded,
   * so there is nothing to ask the chain about and this really is unknown.
   */
  | "unknown"
  /** Nothing was in flight at all. */
  | "none";

export type ReconcileResult = {
  outcome: ReconcileOutcome;
  stepId?: string;
  hash?: Hash;
  /**
   * Set on `unknown`: whether that step has a `canSkip`, and so can tell on its
   * own whether the work already happened. When it is `false`, nothing in the
   * run can rule out a signature that landed after the tab died, and the screen
   * should say so before offering resume.
   */
  canSelfCheck?: boolean;
};

/**
 * Shown before a single wallet prompt on resume, so nobody signs blind.
 * `changes` is adapter-supplied, re-quoted amounts, moved prices, etc.
 */
export type ResumePreflightDiff = {
  ageMs: number;
  reconcile: ReconcileResult;
  completed: StepSummary[];
  pending: StepSummary[];
  changes: Array<{ label: string; before: string; after: string; changePct?: number }>;
};

// ---------------------------------------------------------------------------
// Domain adapter hooks
// ---------------------------------------------------------------------------

/** Awaited between steps, so a re-quote lands before the next build. */
export type FlowHooks<TSnapshot, TCtx> = {
  afterStep?(args: {
    ctx: TCtx;
    snapshot: Readonly<TSnapshot>;
    completed: StepSummary;
    receipt: TransactionReceipt | null;
    pending: TxStep<TSnapshot, TCtx>[];
  }): MaybeAsync<AfterStepResult<TSnapshot, TCtx> | undefined | void>;

  onResume?(args: {
    ctx: TCtx;
    snapshot: Readonly<TSnapshot>;
    pending: TxStep<TSnapshot, TCtx>[];
    persistedAt: number;
    /**
     * A transaction still in the mempool, if reconciliation found one.
     *
     * Returning a `pending` plan that still contains this `stepId` says that
     * this broadcast transaction still does the job, and the run will adopt it
     * rather than sign again. If a re-quote means it no longer does, leave the
     * id out of the plan, or trash the run.
     */
    inFlight?: { stepId: string; hash: Hash };
  }): MaybeAsync<OnResumeResult<TSnapshot, TCtx> | undefined | void>;
};

/** A hook may answer now or later, and may have nothing to say at all. */
type MaybeAsync<T> = T | Promise<T>;

export type AfterStepResult<TSnapshot, TCtx> = {
  ctx?: TCtx;
  /**
   * An object is merged; a function folds into what is already there. The live
   * snapshot is frozen, so a function has to return a new object rather than
   * write into the one it is handed.
   */
  snapshotPatch?: Partial<TSnapshot> | ((prev: Readonly<TSnapshot>) => TSnapshot);
  /** Replaces the steps not yet settled, a re-quote may change what is left to do. */
  pending?: TxStep<TSnapshot, TCtx>[];
  /** Toast copy, e.g. "slippage adjusted batch 2". */
  inform?: string;
  /** Stops the run before the next prompt, e.g. a quote moved out of tolerance. */
  pause?: boolean;
};

export type OnResumeResult<TSnapshot, TCtx> = {
  ctx?: TCtx;
  pending?: TxStep<TSnapshot, TCtx>[];
  staleWarning?: string;
  changes?: ResumePreflightDiff["changes"];
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type OrchestratorEvent<TSnapshot = unknown, TCtx = unknown> =
  | { type: "flow:started"; flowId: string; total: number }
  | { type: "step:pending"; stepId: string; label: string; index: number; total: number }
  | { type: "step:submitted"; stepId: string; hash: Hash }
  /** A wallet replaced the transaction. `repriced` keeps going; the others stop the run. */
  | { type: "step:replaced"; stepId: string; from: Hash; to: Hash; reason: TxReplacementReason }
  | { type: "step:confirmed"; stepId: string; hash: Hash; receipt: TransactionReceipt }
  | { type: "step:skipped"; stepId: string }
  | { type: "step:failed"; stepId: string; error: FlowError }
  | { type: "snapshot:updated"; snapshot: TSnapshot; source: SnapshotSource }
  | { type: "flow:paused"; reason: PauseReason }
  /** The run stopped somewhere retrying will not help. Never paired with `flow:paused`. */
  | { type: "flow:failed"; error: FlowError }
  | { type: "flow:resuming" }
  | { type: "flow:completed" }
  /** `abandoned` is the transaction left on chain, if there was one. At most one step is ever in flight. */
  | { type: "flow:trashed"; abandoned?: Hash }
  | { type: "resume:review-ready"; persisted: PersistedFlowRun<TSnapshot, TCtx> }
  | { type: "resume:preflight"; diff: ResumePreflightDiff; staleWarning?: string }
  | { type: "inform"; message: string };

export type OrchestratorEventType = OrchestratorEvent["type"];

/** `adapter` is a patch from `afterStep` with no receipt behind it, e.g. after a skip. */
export type SnapshotSource = "receipt" | "user" | "requote" | "adapter";

export type Unsubscribe = () => void;

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
  type TxStep,
} from "@foresight/tx-orchestrator";
import type { Address, Hash } from "viem";

import { chainText, OUT_OF_FUNDS, REVERTS } from "@/utils/txErrorText";

import type { ExactInputQuoter, SwapQuoter } from "@/lib/swap/types";

import type { CreditsRoute } from "@/config/contracts";

import { hasUnanswered } from "./interrupted";
import type { RunOwnership } from "./ownership";
import type { PredictDriver, PredictFailureReason, PredictProgress, PredictStepRow } from "./types";
import {
  assertRoutes,
  AtEstimatesError,
  createPredictHooks,
  CreditsUnavailableError,
  heldMoves,
  isTx,
  NoRouteError,
  planPredict,
  PlansMovedError,
  PredictConfigError,
  QuoteFailedError,
  sizeBatches,
  STEP_ID,
  tradeWalletShare,
  TxPendingError,
  type PredictDeps,
} from "../flow/plan";
import type {
  HeldTo,
  MovedPlans,
  PlannedRequest,
  PredictCtx,
  PredictOption,
  PredictReader,
  PredictRequest,
  PredictSlippage,
  PredictSnapshot,
  UnansweredSend,
} from "../flow/types";

/** An option's market and the tokens a run approves and swaps for it. */
export type OptionTokens = Omit<PredictOption, "targetPriceWad">;

/** The trade wallet, or the wallet's credits, hold less than the prediction was shown to draw on. */
class TradeWalletShortError extends Error {}

/** The chain's clock has passed the session's close. */
class SessionClosedError extends Error {}

/** Chain reads for a send that errored: `waitMs` for a lost answer, `graceMs` for a coded error, which the
 * wallet's own node may have broadcast before this app's node sees it. */
const UNANSWERED_SEND = { waitMs: 120_000, pollMs: 2_000, graceMs: 4_000 };

const TRANSPORT_FAILURES = new Set(["TimeoutError", "HttpRequestError"]);

/** The request timed out or never reached the node, so the transaction may have gone out. */
function unanswered(error: unknown): boolean {
  let link: unknown = error;
  for (let depth = 0; typeof link === "object" && link !== null && depth < 10; depth++) {
    const { name, code, cause } = link as { name?: unknown; code?: unknown; cause?: unknown };
    // a JSON-RPC error code is the node's answer
    if (typeof code === "number") return false;
    if (typeof name === "string" && TRANSPORT_FAILURES.has(name)) return true;
    link = cause;
  }
  return false;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

const sameSlippage = (a: PredictSlippage, b: PredictSlippage) =>
  a.tradeBps === b.tradeBps && a.creditsBps === b.creditsBps;

const sameAddress = (a: unknown, b: Address | null) =>
  b === null ? a === null : typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/** True when every contract a saved run would sign against is the one the app names now. */
function sameContracts(saved: PredictCtx, current: PredictCtx): boolean {
  const pairs: Array<[unknown, Address | null]> = [
    [saved.executor, current.executor],
    [saved.factory, current.factory],
    [saved.router, current.router],
    [saved.collateral, current.collateral],
    [saved.parentMarket, current.parentMarket],
    [saved.sDaiAdapter, current.sDaiAdapter],
  ];
  const savedCredits: Partial<CreditsRoute> | null | undefined = saved.credits;
  if (current.credits === null) {
    if (savedCredits !== null) return false;
  } else {
    if (!savedCredits) return false;
    for (const key of ["token", "manager", "wxdai", "swaprRouter"] as const) {
      pairs.push([savedCredits[key], current.credits[key]]);
    }
  }
  return pairs.every(([a, b]) => sameAddress(a, b));
}

/** True when every saved option names the market and tokens the session has for it. */
function sameOptions(saved: readonly PredictOption[], session: readonly OptionTokens[]): boolean {
  return saved.every((option) => {
    const known = session.find((each) => sameAddress(option.childMarket, each.childMarket));
    return (
      known !== undefined &&
      (["underlying", "upToken", "downToken", "invalidToken"] as const).every((key) =>
        sameAddress(option[key], known[key]),
      )
    );
  });
}

/** Why a saved run cannot be continued from the connected wallet, if it cannot. */
function foreign(saved: PredictCtx, current: PredictCtx): "wrong-wallet" | "wrong-chain" | "unknown" | undefined {
  if (String(saved.owner).toLowerCase() !== current.owner.toLowerCase()) return "wrong-wallet";
  if (saved.chainId !== current.chainId) return "wrong-chain";
  if (!sameContracts(saved, current)) return "unknown";
  return undefined;
}

/** Drives one prediction: the orchestrator's run, flattened into what the popup reads. */
export function createPredictRun(args: {
  gateway: TxGateway;
  reader: PredictReader;
  quoter: SwapQuoter;
  creditsQuoter?: ExactInputQuoter;
  /** Keyed per chain, owner and session, so no two runs share a stored record. */
  flowId: string;
  ctx: () => PredictCtx;
  snapshot: () => PredictRequest;
  /** The visitor's slippage settings now; a held run's retry takes them up. */
  slippage?: () => PredictSlippage | undefined;
  store?: FlowRunStore;
  onComplete?: () => void;
  now?: () => number;
  /** How long, and how often, the chain is read for a send that errored. */
  unansweredSend?: { waitMs: number; pollMs: number; graceMs?: number };
  /** Which tab drives the stored run; without it this driver takes it as its own. */
  ownership?: RunOwnership;
  /** When the session stops trading, in unix seconds; nothing is signed once the chain's clock reaches it. */
  closesAt?: number | null;
  /** Every option of the session, which a stored run's options must match before it is restored. */
  sessionOptions?: () => readonly OptionTokens[];
}): PredictDriver {
  const listeners = new Set<() => void>();
  /** Options left out by each batch not yet settled, by step id; a settled batch's are kept in the run's snapshot. */
  const leavingOut = new Map<string, Address[]>();
  let failure: PredictProgress["failure"];
  let retryFailed: (() => void) | undefined;
  let planned: PredictStepRow[] = [];
  /** Set while the routes are checked, before the orchestrator has a run; reset and dispose clear it. */
  let checking: object | undefined;
  /** The reason a step failed with, which the orchestrator's own causes cannot carry. */
  let buildFailure: "no-route" | "at-estimates" | "quote" | "funds" | "credits" | "pending" | "closed" | undefined;
  /** Set while a sent transaction's outcome is read from the chain; the run itself stays stopped meanwhile. */
  let reconciling = false;
  /** Set once a stored run is restored, until it is thrown away: the popup shows its snapshot, not the form. */
  let recovered = false;
  /** A restored run, reconciled, waiting for the visitor to resume it. */
  let reviewing = false;
  /** Set once this run sends a transaction that moves money; a failed step put back to pending does not clear it. */
  let moneyMoved = false;
  /** Set while the chain is read for a send that errored. */
  let awaitingUnanswered = false;
  /** What the run is held to; none for a recovered run. */
  let held: HeldTo | undefined;
  /** Set when a batch found the pools giving another plan than `held`; cleared by `confirm` and `reset`. */
  let moved: MovedPlans | undefined;
  /** A batch's moved plans, from its build's error to the pause it causes. */
  let movedByBuild: MovedPlans | undefined;
  /** Slippage a retry took up, stored with the run only once `confirm` accepts the plans it gives. */
  let pendingSlippage: PredictSlippage | undefined;
  /** Set once this tab holds the stored run; until then nothing here restores, signs or trashes it. */
  let owned = !args.ownership;
  let release: (() => void) | undefined;
  /** Set while this tab asks for the run; reset and dispose drop the answer. */
  let claiming: object | undefined;
  let cached: PredictProgress;

  const deps: PredictDeps = {
    reader: args.reader,
    quoter: args.quoter,
    creditsQuoter: args.creditsQuoter,
    heldTo: () => held,
    onLeftOut: (option, _reason, stepId) => {
      const left = leavingOut.get(stepId) ?? [];
      if (!left.includes(option.childMarket)) leavingOut.set(stepId, [...left, option.childMarket]);
    },
  };

  const waiting = { ...UNANSWERED_SEND, ...args.unansweredSend };

  /** The hash the chain mined `send` under, `"outstanding"` if it is unmined or unread when the wait runs out. */
  async function answerOf(
    send: UnansweredSend,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<Hash | "outstanding" | undefined> {
    const deadline = Date.now() + waitMs;
    let outstanding = true;
    while (!signal?.aborted) {
      const found = await args.reader.sentWithNonce(send).catch(() => undefined);
      if (found?.status === "mined") return isTx(found, send.tx) ? found.hash : undefined;
      if (found?.status === "taken") return undefined;
      if (found) outstanding = found.status === "pending";
      if (Date.now() >= deadline) break;
      await sleep(waiting.pollMs, signal);
    }
    return outstanding ? "outstanding" : undefined;
  }

  /** Stores `send` with the run, so neither a reset nor a reload forgets it before its nonce is read. */
  function holdUnanswered(stepId: string, send: UnansweredSend) {
    orchestrator.updateSnapshot((prev) => ({ ...prev, unanswered: { ...prev.unanswered, [stepId]: send } }), {
      source: "adapter",
    });
  }

  function forgetUnanswered(stepId: string) {
    if (!orchestrator.getRun()?.snapshot.unanswered?.[stepId]) return;
    orchestrator.updateSnapshot(
      (prev) => {
        const { [stepId]: _settled, ...rest } = prev.unanswered ?? {};
        const { unanswered: _all, ...without } = prev;
        return Object.keys(rest).length > 0 ? { ...without, unanswered: rest } : without;
      },
      { source: "adapter" },
    );
  }

  /** The wallet's send, carried on with the chain's own record of it when the send errors. */
  const gateway: TxGateway = {
    ...args.gateway,
    async sendTransaction(tx, options) {
      const run = orchestrator.getRun();
      const stepId = run ? currentEntry(run.steps)?.stepId : undefined;
      if (!run || stepId === undefined) return args.gateway.sendTransaction(tx, options);

      const owner = run.ctx.owner;
      const [nonce, fromBlock] = await Promise.all([args.reader.nextNonce(owner), args.reader.latestBlock()]);
      const send = { owner, nonce, fromBlock, tx };
      // held before the wallet opens: a prompt approved after the tab closed has no hash stored to find it by
      holdUnanswered(stepId, send);
      try {
        return await args.gateway.sendTransaction(tx, options);
      } catch (error) {
        // a disposed run keeps the send for whichever driver recovers it
        if (options?.signal?.aborted) throw error;
        // a coded wallet error can still follow a broadcast; only a rejection proves nothing went out
        if (classifyTxError(error) === "rejected") {
          forgetUnanswered(stepId);
          throw error;
        }
        const lost = unanswered(error);
        awaitingUnanswered = true;
        notify();
        const answer = await answerOf(send, lost ? waiting.waitMs : waiting.graceMs, options?.signal).finally(() => {
          awaitingUnanswered = false;
        });
        if (answer !== undefined && answer !== "outstanding") return answer;
        if (answer === undefined && !lost) {
          forgetUnanswered(stepId);
          throw error;
        }
        if (stepId !== STEP_ID.createExecutor) moneyMoved = true;
        throw answer === "outstanding" ? new TxPendingError() : error;
      }
    },
  };

  /** Throws once the chain's clock has reached the session's close. */
  async function assertOpen() {
    if (args.closesAt == null) return;
    if ((await args.reader.latestTimestamp()) >= BigInt(args.closesAt)) throw new SessionClosedError();
  }

  /** Each step first reads how its errored send ended, and is built only while the session is open. */
  function guardedSteps(steps: TxStep<PredictSnapshot, PredictCtx>[]): TxStep<PredictSnapshot, PredictCtx>[] {
    return steps.map((step) => ({
      ...step,
      build: async (ctx, snap) => {
        await assertOpen();
        return step.build(ctx, snap);
      },
      canSkip: async (ctx, snap) => {
        const send = snap.unanswered?.[step.id];
        if (send) {
          const found = await args.reader.sentWithNonce(send);
          if (found.status === "pending") throw new TxPendingError();
          forgetUnanswered(step.id);
          if (found.status === "mined" && found.success && isTx(found, send.tx)) return true;
        }
        return step.canSkip ? step.canSkip(ctx, snap) : false;
      },
    }));
  }

  const orchestrator = createTxOrchestrator<PredictSnapshot, PredictCtx>({
    adapterId: "predict-flow",
    gateway,
    hooks: createPredictHooks({
      reader: args.reader,
      takeLeftOut: (stepId) => {
        const left = leavingOut.get(stepId) ?? [];
        leavingOut.delete(stepId);
        return left;
      },
    }),
    store: args.store,
    now: args.now,
    // A build reads the chain and the indexer before it signs anything. Those failures are
    // transient and leave nothing behind, so they pause for a retry rather than ending the run.
    // A missing route is fatal to the orchestrator and a failed quote pauses it.
    classifyError: (error) => {
      if (error instanceof SessionClosedError) {
        buildFailure = "closed";
        return "unknown";
      }
      if (error instanceof PlansMovedError) {
        movedByBuild = error.moved;
        return "rpc";
      }
      buildFailure =
        error instanceof NoRouteError
          ? "no-route"
          : error instanceof AtEstimatesError
            ? "at-estimates"
            : error instanceof QuoteFailedError
              ? "quote"
              : error instanceof CreditsUnavailableError
                ? "credits"
                : error instanceof TxPendingError
                  ? "pending"
                  : undefined;
      if (buildFailure === "quote" || buildFailure === "credits" || buildFailure === "pending") return "rpc";
      if (buildFailure === "no-route" || buildFailure === "at-estimates" || error instanceof PredictConfigError) {
        return "unknown";
      }
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
    if (!run) return failure ? "halted" : checking ? "quoting" : moved ? "moved" : "idle";
    if (moved && (run.status === "paused" || run.status === "failed")) return "moved";
    if (checking && run.status !== "running") return "quoting";
    if ((reconciling || awaitingUnanswered) && !failure) return "confirming";
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
    const failedStep = moved ? undefined : errorOf(run)?.stepId;

    const steps = (run?.steps ?? []).map((entry): PredictStepRow => {
      const done = settled.get(entry.stepId);
      if (done) {
        const hash = done.outcome.status === "confirmed" ? { hash: done.outcome.hash } : {};
        return { id: entry.stepId, label: entry.label, state: "success", ...hash };
      }
      if (entry.stepId === current) return { id: entry.stepId, label: entry.label, state: "running" };
      if (entry.stepId === failedStep) return { id: entry.stepId, label: entry.label, state: "error" };
      return { id: entry.stepId, label: entry.label, state: "pending" };
    });

    const pendingHash = pendingHashOf(run);
    const rows = steps.length > 0 ? steps : planned;
    const batchRows = rows.filter((row) => row.id.startsWith("predict-"));

    const settledLeftOut = run?.snapshot.leftOut ?? [];
    const leftOut = [...settledLeftOut, ...[...leavingOut.values()].flat()];

    return {
      stage: stage(),
      steps: rows,
      leftOut: leftOut.filter((market, index) => leftOut.indexOf(market) === index),
      batchesDone: batchRows.filter((row) => row.state === "success").length,
      batches: batchRows.length,
      failure,
      ...(pendingHash ? { pendingHash } : {}),
      ...(moneyMoved ? { moneyMoved: true as const } : {}),
      ...(hasUnanswered(run?.snapshot) ? { unanswered: true as const } : {}),
      ...(recovered && run ? { recovered: run.snapshot } : {}),
      ...(moved ? { moved } : {}),
      ...(held ? { held } : {}),
    };
  }

  cached = buildProgress();

  orchestrator.subscribe(notify);
  orchestrator.on("step:submitted", (event) => {
    if (event.stepId !== STEP_ID.createExecutor) moneyMoved = true;
    // the hash is stored by now, and the receipt settles the step from here
    forgetUnanswered(event.stepId);
  });
  orchestrator.on("flow:paused", () => {
    if (movedByBuild) {
      moved = movedByBuild;
      movedByBuild = undefined;
      buildFailure = undefined;
      notify();
      return;
    }
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
        else if (error instanceof AtEstimatesError) report("at-estimates");
        else if (error instanceof QuoteFailedError) report("quote", action);
        else if (error instanceof CreditsUnavailableError) report("credits");
        else if (error instanceof TxPendingError) report("pending", action);
        else if (error instanceof TradeWalletShortError) report("balance");
        else if (error instanceof SessionClosedError) report("closed");
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
    const session = args.sessionOptions?.();
    if (session && !sameOptions(stored.snapshot.options, session)) {
      report("unknown");
      return;
    }

    const steps = guardedSteps(planPredict(stored.snapshot, deps));
    const restored = orchestrator.restore({ flowId: args.flowId, steps });
    if (!restored) return;

    planned = [];
    held = undefined;
    recovered = true;
    reconciling = true;
    notify();
    const found = await orchestrator.reconcileInFlight().finally(() => {
      reconciling = false;
    });
    if (found.outcome === "reverted") return;
    // A transfer signed as the tab died left no hash, and its own transaction shows only once it mines.
    if (found.outcome === "unknown" && (found.stepId === STEP_ID.deposit || found.stepId === STEP_ID.addCredits)) {
      const transfer = steps.find((step) => step.id === found.stepId);
      const landed = await Promise.resolve(transfer?.canSkip?.(stored.ctx, stored.snapshot)).catch((error: unknown) => {
        if (error instanceof TxPendingError) return false;
        throw error;
      });
      if (!landed) {
        report("deposit-unconfirmed", resumeRun);
        return;
      }
    }
    reviewing = true;
    notify();
  });

  /** Pins the trade wallet's balance before anything is signed, and checks a route exists for the plan held to. */
  async function prepare(ctx: PredictCtx, requested: PlannedRequest): Promise<PredictSnapshot> {
    const [collateralAtStart, creditsAtStart, latest] = await Promise.all([
      args.reader.collateralBalance(ctx.executor),
      args.reader.creditsBalance(ctx.executor),
      args.reader.latestBlock(),
    ]);
    // nothing this run sends can land in a block already mined, which may hold an earlier run's
    const fromBlock = latest + 1n;
    if (collateralAtStart < tradeWalletShare(requested)) throw new TradeWalletShortError();
    // an sDAI deposit lands as sent, so the split may not ask for more than it and the trade wallet's share
    if (!requested.depositNative && requested.collateralIn > requested.deposit + tradeWalletShare(requested)) {
      throw new TradeWalletShortError();
    }
    if (creditsAtStart + requested.creditsFromEoa < requested.creditsToSpend) throw new TradeWalletShortError();
    if (requested.creditsFromEoa > 0n && (await args.reader.creditsBalance(ctx.owner)) < requested.creditsFromEoa) {
      throw new TradeWalletShortError();
    }
    const snapshot = { ...requested, collateralAtStart, creditsAtStart, fromBlock };
    await assertRoutes(ctx, snapshot, deps);
    return snapshot;
  }

  /** The batch size the last check planned with; confirming at moved plans the batches it showed. */
  let plannedSize: number | undefined;

  const startRun = (heldTo?: HeldTo, size?: number) =>
    detached(async () => {
      report(undefined);
      held = heldTo;
      moved = undefined;
      pendingSlippage = undefined;
      leavingOut.clear();
      moneyMoved = false;

      const requested: PredictRequest = args.snapshot();
      const ctx = args.ctx();
      const check = {};
      checking = check;
      notify();

      const checked = await (async () => {
        await assertOpen();
        const optionsPerBatch = size ?? (await sizeBatches(ctx, requested, deps, await args.reader.blockGasLimit()));
        const sized = { ...requested, optionsPerBatch };
        const steps = guardedSteps(planPredict(sized, deps));
        // The rows exist before the run does, so the popup shows the list while the routes are checked.
        if (checking === check) {
          plannedSize = optionsPerBatch;
          planned = steps.map((step) => ({ id: step.id, label: step.label, state: "pending" }));
          notify();
        }
        return { steps, snapshot: await prepare(ctx, sized) };
      })().then(
        (ready) => ready,
        (error: unknown) => ({ error }),
      );
      if (checking !== check) return;
      checking = undefined;
      if ("error" in checked) {
        if (!(checked.error instanceof PlansMovedError)) throw checked.error;
        moved = checked.error.moved;
        notify();
        return;
      }
      await orchestrator.start({ flowId: args.flowId, snapshot: checked.snapshot, ctx, steps: checked.steps });
    })();

  /**
   * Re-plans every batch still to land at `settings` against what the run is held to. A changed plan stops the
   * run at moved with `settings` pending; an unchanged one stores them and carries on with `carryOn`.
   */
  const replanAt = (settings: PredictSlippage, carryOn: (() => void) | undefined) =>
    detached(async () => {
      const run = orchestrator.getRun();
      if (!run) return;
      const settled = new Set(settledEntries(run.steps).map((step) => step.stepId));
      const check = {};
      checking = check;
      notify();
      const found = await heldMoves(run.ctx, { ...run.snapshot, slippage: settings }, deps, settled).catch(
        (error: unknown) => {
          if (checking === check) checking = undefined;
          throw error;
        },
      );
      if (checking !== check) return;
      checking = undefined;
      if (found) {
        pendingSlippage = settings;
        moved = { ...found, bySlippage: true };
        notify();
        return;
      }
      orchestrator.updateSnapshot({ slippage: settings }, { source: "requote" });
      carryOn?.();
    })();

  /** Runs `then` once this tab holds the run, or reports it held by another tab. */
  function claimed(then: () => void) {
    if (owned) {
      then();
      return;
    }
    const claim = {};
    claiming = claim;
    void args.ownership!.claim(args.flowId).then((letGo) => {
      if (claiming !== claim) {
        letGo?.();
        return;
      }
      claiming = undefined;
      if (!letGo) {
        report("elsewhere", () => claimed(then));
        return;
      }
      release = letGo;
      owned = true;
      then();
    });
  }

  return {
    start(heldTo) {
      if (checking || claiming || orchestrator.getStatus() !== "idle") return;
      claimed(() => {
        // A stored run has steps that may already be on chain, and `start` would refuse anyway.
        if (args.store?.load(args.flowId)) recoverRun();
        else startRun(heldTo);
      });
    },

    confirm() {
      if (!moved || checking) return;
      const next: HeldTo = {
        plans: { ...held?.plans, ...moved.plans },
        ...((moved.credits ?? held?.credits) ? { credits: moved.credits ?? held?.credits } : {}),
      };
      const status = orchestrator.getStatus();
      if (status === "idle") {
        startRun(next, plannedSize);
        return;
      }
      if (status !== "paused" && status !== "failed") return;
      held = next;
      moved = undefined;
      if (pendingSlippage) orchestrator.updateSnapshot({ slippage: pendingSlippage }, { source: "requote" });
      pendingSlippage = undefined;
      report(undefined);
      resumeRun();
    },

    recover() {
      if (checking || claiming || orchestrator.getStatus() !== "idle" || !args.store?.load(args.flowId)) return;
      claimed(recoverRun);
    },

    resume() {
      if (!reviewing) return;
      reviewing = false;
      // The chain is read again: a transaction pending at review may have mined or dropped since.
      reconcileRun();
    },

    retry() {
      const again = retryFailed;
      // A batch that is rebuilt gives its options another go; a sent one's left-out options stand until its receipt is read.
      const run = orchestrator.getRun();
      const sent = run && pendingHashOf(run) ? currentEntry(run.steps)?.stepId : undefined;
      for (const stepId of [...leavingOut.keys()]) if (stepId !== sent) leavingOut.delete(stepId);
      const settings = args.slippage?.();
      report(undefined);
      // a sent batch is settled first, at the slippage it was signed with
      if (run && !sent && held && settings && !sameSlippage(run.snapshot.slippage, settings)) {
        replanAt(settings, again);
        return;
      }
      again?.();
    },

    reset() {
      const stored = args.store?.load<PredictSnapshot, PredictCtx>(args.flowId);
      if (hasUnanswered(orchestrator.getRun()?.snapshot ?? stored?.snapshot)) return;
      checking = undefined;
      claiming = undefined;
      const mismatch = stored && foreign(stored.ctx, args.ctx());
      // another wallet's or network's run is kept for it; one naming other contracts can never resume
      if (owned && (!mismatch || mismatch === "unknown")) orchestrator.trash(args.flowId);
      recovered = false;
      reviewing = false;
      moneyMoved = false;
      buildFailure = undefined;
      leavingOut.clear();
      planned = [];
      held = undefined;
      moved = undefined;
      movedByBuild = undefined;
      pendingSlippage = undefined;
      report(undefined);
    },

    dispose() {
      checking = undefined;
      claiming = undefined;
      orchestrator.dispose();
      release?.();
      release = undefined;
      owned = !args.ownership;
    },

    getProgress: () => cached,

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

import { describe, expect, it } from "vitest";

import { FlowStateError } from "../errors";
import type { FlowHooks, ResumePreflightDiff, TxStep } from "../types";
import {
  doneIds,
  harness,
  inFlightHash,
  leftIds,
  outcomeOf,
  persistedHash,
  persistedIds,
  reasonOf,
  settle,
  step,
  type Harness,
  type TestCtx,
  type TestSnapshot,
} from "./support/harness";

/**
 * One flow, from the first click to the last receipt, in the order it happens.
 *
 * The rest of the suite is sliced by concern: `run` for the happy path, `wallet`
 * for the ways a wallet misbehaves, `control` for pause and trash, `resume` for
 * coming back. Read those to find out whether a behaviour is covered. Read this
 * one to find out what using the thing actually feels like.
 *
 * The story is a session deploy, which is the real adapter in `apps/web`: a fee
 * approval that turns out to be unnecessary, a parent market, then three
 * batches of child markets that cannot be built until the parent confirms and
 * hands back a session id. Somewhere in the middle the tab dies with a
 * transaction still mining.
 *
 * The acts run in order and share one story, which is not how tests usually
 * work. It is deliberate here: each act is a checkpoint in a single run, and
 * splitting them into independent cases would mean rebuilding the world five
 * times and losing the thread.
 */

const HOUR = 60 * 60 * 1000;

/** Stands in for the chain read a real `canSkip` would do. */
const ALLOWANCE_ALREADY_GRANTED = true;

/**
 * The adapter's plan, handed to `start()` and handed again to `restore()` on
 * the way back. It is a function, not a constant, because the second visit
 * plans fresh: the persisted run holds outcomes, never builders.
 */
function planSessionDeploy(): TxStep<TestSnapshot, TestCtx>[] {
  const batch = (n: number) =>
    step(`children-${n}`, {
      // Resuming after an interrupted deploy: if these markets are already on
      // chain, signing again would revert on the factory's index check.
      canSkip: (_ctx, snapshot) => snapshot.deployed.includes(`children-${n}`),
    });

  return [step("approve", { canSkip: () => ALLOWANCE_ALREADY_GRANTED }), step("parent"), batch(1), batch(2), batch(3)];
}

const sessionFlow: FlowHooks<TestSnapshot, TestCtx> = {
  afterStep({ completed, receipt, pending }) {
    // A skipped step has no receipt and deployed nothing.
    if (!receipt) return;

    const moreBatchesLeft = completed.stepId.startsWith("children-") && pending.length > 0;

    return {
      // The real adapter reads addresses out of the logs. The step id stands in
      // for one, and the fold matters more than the value: this is how a later
      // step learns what an earlier one produced.
      snapshotPatch: (previous) => ({ ...previous, deployed: [...previous.deployed, completed.stepId] }),
      inform: completed.stepId === "parent" ? "Decision market created. The branches come next." : undefined,
      // One batch per wallet prompt, and the deployer decides when the next one
      // opens. Not a failure, just a stop.
      pause: moreBatchesLeft,
    };
  },

  onResume() {
    // A real adapter would compare `persistedAt` against its own clock and
    // re-quote here. What matters is that it happens before any wallet opens.
    return {
      staleWarning: "Gas has moved since you started. Check the fee before signing.",
      changes: [{ label: "Network fee", before: "12 gwei", after: "31 gwei" }],
    };
  },
};

/** The first visit. Its three scripts are the parent, batch one, and batch two. */
let first: Harness;
/** The second visit, over the same storage. One script: batch three. */
let second: Harness;
/** The transaction that was still mining when the tab went away. */
let inFlight: `0x${string}`;
let diff: ResumePreflightDiff;

describe("a session deploy, start to finish", () => {
  it("act 1: skips the work the chain already has, then banks the parent", async () => {
    first = harness({
      scripts: [
        {}, // parent: signed, mined
        {}, // batch one: signed, mined
        { mine: "hold" }, // batch two: broadcast, and then the tab dies
      ],
      hooks: sessionFlow,
    });

    // Resolves at the adapter's between-batches pause, not at completion.
    await first.start(planSessionDeploy());

    // The allowance was standing, so the approve never reached the wallet.
    expect(outcomeOf(first.orchestrator.getRun(), "approve")).toEqual({ status: "skipped" });
    expect(first.gateway.signRequests).toHaveLength(2);

    // What the parent's receipt taught the flow, which is what batch one was
    // then built against.
    expect(first.orchestrator.getRun()?.snapshot.deployed).toEqual(["parent", "children-1"]);

    // The whole sequence a stepper renders from, in order. Note there is no
    // `step:pending` for the skipped step: nothing was ever built or prompted.
    expect(first.types()).toEqual([
      "flow:started",
      "step:skipped", // approve
      "step:pending", // parent
      "step:submitted",
      "step:confirmed",
      "snapshot:updated",
      "inform",
      "step:pending", // children-1
      "step:submitted",
      "step:confirmed",
      "snapshot:updated",
      "flow:paused",
    ]);
  });

  it("act 2: stops between batches, so the next popup is asked for rather than sprung", () => {
    const run = first.orchestrator.getRun();

    expect(run?.status).toBe("paused");
    // An adapter pause is a decision point, not a failure. Nothing to retry.
    expect(reasonOf(run)).toBe("adapter");
    expect(errorless(run)).toBe(true);

    expect(doneIds(run)).toEqual(["approve", "parent", "children-1"]);
    expect(leftIds(run)).toEqual(["children-2", "children-3"]);

    // The screen stays frozen: a paused run still owns it.
    expect(first.scope.isFrozen()).toBe(true);

    // And it is all on disk already, in case the next act never happens.
    expect(persistedIds(first.store.load("flow-1"))).toEqual({
      done: ["approve", "parent", "children-1"],
      left: ["children-2", "children-3"],
    });
  });

  it("act 3: refuses to let the draft move under a half-signed run", () => {
    expect(() => first.orchestrator.updateSnapshot({ title: "Arrakis" }, { source: "user" })).toThrow(FlowStateError);

    // The adapter's own patches still land: a re-quote is exactly the update
    // that should reach a paused run.
    first.orchestrator.updateSnapshot({ title: "Arrakis" }, { source: "requote" });

    expect(first.orchestrator.getRun()?.snapshot.title).toBe("Arrakis");
    expect(first.events).toContainEqual({
      type: "snapshot:updated",
      snapshot: { title: "Arrakis", deployed: ["parent", "children-1"] },
      source: "requote",
    });
  });

  it("act 4: broadcasts the next batch, and then the tab goes away mid-flight", async () => {
    // The deployer clicked continue.
    void first.orchestrator.resume();
    await settle(20);

    const hash = inFlightHash(first.orchestrator.getRun());
    if (!hash) throw new Error("expected batch two to be in flight");
    inFlight = hash;

    expect(first.orchestrator.getStatus()).toBe("running");
    expect(first.gateway.signRequests).toHaveLength(3);

    // The hash reached disk before the event announcing it did, which is the
    // whole reason the next act can find it.
    expect(persistedHash(first.store.load("flow-1"))).toBe(inFlight);
    expect(first.store.load("flow-1")).toMatchObject({ status: "running" });

    // Nothing below this line tidies up. The tab is gone.
  });

  it("act 5: comes back to a run nobody paused, and touches no wallet doing it", () => {
    // A fresh orchestrator over the same storage. This is the reload.
    second = harness({ storage: first.storage, hooks: sessionFlow, scripts: [{}] });
    second.advance(2 * HOUR);

    // What a "you have an unfinished deploy" banner reads.
    expect(second.orchestrator.listPersisted()).toHaveLength(1);

    const persisted = second.orchestrator.restore({ flowId: "flow-1", steps: planSessionDeploy() });

    expect(persisted).not.toBeNull();
    // Persisted mid-run, so it was cut off rather than stopped.
    expect(reasonOf(second.orchestrator.getRun())).toBe("interrupted");
    expect(doneIds(second.orchestrator.getRun())).toEqual(["approve", "parent", "children-1"]);
    // The snapshot came back with it, re-quote and all.
    expect(second.orchestrator.getRun()?.snapshot).toEqual({ title: "Arrakis", deployed: ["parent", "children-1"] });

    // A restored run owns the screen until it is resumed or trashed.
    expect(second.scope.isFrozen()).toBe(true);
    expect(second.gateway.signRequests).toEqual([]);
    expect(second.types()).toContain("resume:review-ready");
  });

  it("act 6: asks the chain what happened, and the adapter what changed, before anyone signs", async () => {
    // Batch two mined while the tab was closed.
    second.gateway.setChainState(inFlight, { receipt: "success", known: true });

    diff = await second.orchestrator.preflight();

    expect(diff.reconcile).toEqual({ outcome: "confirmed", stepId: "children-2", hash: inFlight });
    expect(diff.completed.map((entry) => entry.stepId)).toEqual(["approve", "parent", "children-1", "children-2"]);
    expect(diff.pending.map((entry) => entry.stepId)).toEqual(["children-3"]);
    expect(diff.ageMs).toBe(2 * HOUR);

    // What the review screen puts in front of the deployer.
    expect(diff.changes).toEqual([{ label: "Network fee", before: "12 gwei", after: "31 gwei" }]);
    expect(second.events).toContainEqual({
      type: "resume:preflight",
      diff,
      staleWarning: "Gas has moved since you started. Check the fee before signing.",
    });

    // All of that, and still not one wallet prompt.
    expect(second.gateway.signRequests).toEqual([]);
  });

  it("act 7: signs only what is genuinely left, and lets go when it is done", async () => {
    await second.orchestrator.resume();

    // Five steps in the plan. One signature on this visit, for batch three.
    expect(second.gateway.signRequests).toHaveLength(1);
    expect(second.orchestrator.getStatus()).toBe("completed");
    expect(doneIds(second.orchestrator.getRun())).toEqual([
      "approve",
      "parent",
      "children-1",
      "children-2",
      "children-3",
    ]);

    // Completion clears the run off disk and hands the screen back.
    expect(second.store.load("flow-1")).toBeNull();
    expect(second.scope.isFrozen()).toBe(false);
  });

  it("act 7a: keeps what the reconciled receipt taught the adapter", () => {
    // `children-2` was confirmed by `reconcileInFlight`, not by the loop, and
    // its receipt still reached `afterStep`. An adapter that learns an id or an
    // address from a receipt would otherwise lose it exactly when the tab died
    // on the step that produces it, and every later build would fail.
    expect(second.orchestrator.getRun()?.snapshot.deployed).toEqual([
      "parent",
      "children-1",
      "children-2",
      "children-3",
    ]);
  });
});

/** A pause nobody has to apologise for carries no error. */
function errorless(run: ReturnType<Harness["orchestrator"]["getRun"]>): boolean {
  return (run?.status === "paused" || run?.status === "failed") && run.error === undefined;
}

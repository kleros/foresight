import { describe, expect, it } from "vitest";

import { FlowStateError } from "../errors";
import type { FlowHooks } from "../types";
import {
  doneIds,
  harness,
  inFlightHash,
  leftIds,
  outcomeOf,
  persistedHash,
  settle,
  step,
  type Harness,
  type TestCtx,
  type TestSnapshot,
} from "./support/harness";

type OnResumeArgs = Parameters<NonNullable<FlowHooks<TestSnapshot, TestCtx>["onResume"]>>[0];

const HOUR = 60 * 60 * 1000;

/**
 * The tab closed mid-deploy. Everything here exists so that coming back never
 * re-sends work that is already on chain, and never claims work happened that
 * did not, and so that nobody is asked to sign before seeing what changed.
 */

/** Runs a flow up to a paused first step with a transaction still in flight. */
async function pausedMidFlight(): Promise<{ first: Harness; hash: string }> {
  const first = harness({ scripts: [{ mine: "hold" }] });
  const running = first.start([step("a"), step("b")]);
  await settle();
  first.orchestrator.pause();
  await running;

  const hash = persistedHash(first.store.load("flow-1"));
  if (!hash) throw new Error("expected a transaction in flight");
  return { first, hash };
}

/** A fresh orchestrator over the same storage, the reload. */
function reload(first: Harness) {
  return harness({ storage: first.storage });
}

describe("restoring a run for review", () => {
  it("hydrates what was completed and what is left, without touching the wallet", async () => {
    const { first } = await pausedMidFlight();
    const second = reload(first);

    const persisted = second.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] });

    expect(persisted).not.toBeNull();
    expect(second.orchestrator.getStatus()).toBe("paused");
    expect(leftIds(second.orchestrator.getRun())).toEqual(["a", "b"]);
    expect(second.gateway.signRequests).toEqual([]);
    expect(second.types()).toContain("resume:review-ready");
  });

  it("matches the re-planned steps by id, so a re-plan cannot reorder pending work", async () => {
    const { first } = await pausedMidFlight();
    const second = reload(first);

    // The adapter re-plans and hands back the whole plan, in its own order.
    second.orchestrator.restore({ flowId: "flow-1", steps: [step("b"), step("a")] });

    expect(leftIds(second.orchestrator.getRun())).toEqual(["a", "b"]);
  });

  it("refuses to resume against a plan that lost a step, that would skip or repeat work", async () => {
    const { first } = await pausedMidFlight();
    const second = reload(first);

    expect(() => second.orchestrator.restore({ flowId: "flow-1", steps: [step("a")] })).toThrow(FlowStateError);
  });

  it("refuses a run belonging to another adapter, rather than matching the wrong plan to it", async () => {
    const { first } = await pausedMidFlight();
    // Same storage, different flow type. Storage is shared; runs are not.
    const other = harness({ storage: first.storage, adapterId: "some-other-flow" });

    expect(() => other.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] })).toThrow(
      FlowStateError,
    );
    expect(other.orchestrator.getStatus()).toBe("idle");
    expect(other.scope.isFrozen()).toBe(false);
  });

  it("holds the screen while the decision is pending", async () => {
    const { first } = await pausedMidFlight();
    const second = reload(first);

    second.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] });

    expect(second.scope.isFrozen()).toBe(true);
  });

  it("finds nothing when nothing was persisted", () => {
    const h = harness();

    expect(h.orchestrator.restore({ flowId: "never-ran", steps: [] })).toBeNull();
  });

  it("finds nothing once the run has aged out, an expired run is trashed, not offered", async () => {
    const { first } = await pausedMidFlight();
    const second = reload(first);
    second.advance(73 * HOUR);

    expect(second.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] })).toBeNull();
    expect(second.orchestrator.getStatus()).toBe("idle");
  });

  it("lists incomplete runs for the gate that blocks a second flow", async () => {
    const { first } = await pausedMidFlight();

    expect(
      reload(first)
        .orchestrator.listPersisted()
        .map((r) => r.flowId),
    ).toEqual(["flow-1"]);
  });
});

describe("reconciling a transaction that was in flight", () => {
  it("counts a transaction that mined while away as the step being done", async () => {
    const { first, hash } = await pausedMidFlight();
    const second = reload(first);
    second.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] });
    second.gateway.setChainState(hash as `0x${string}`, { receipt: "success", known: true });

    const result = await second.orchestrator.reconcileInFlight();

    expect(result).toMatchObject({ outcome: "confirmed", stepId: "a", hash });
    expect(doneIds(second.orchestrator.getRun())).toEqual(["a"]);
    expect(leftIds(second.orchestrator.getRun())).toEqual(["b"]);
    expect(second.types()).toContain("step:confirmed");
  });

  it("reports a revert that happened while away", async () => {
    const { first, hash } = await pausedMidFlight();
    const second = reload(first);
    second.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] });
    second.gateway.setChainState(hash as `0x${string}`, { receipt: "reverted", known: true });

    const result = await second.orchestrator.reconcileInFlight();

    expect(result.outcome).toBe("reverted");
    expect(second.orchestrator.getStatus()).toBe("failed");
    expect(doneIds(second.orchestrator.getRun())).toEqual([]);
  });

  it("leaves a transaction still in the mempool in flight, to be adopted", async () => {
    const { first, hash } = await pausedMidFlight();
    const second = reload(first);
    second.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] });
    second.gateway.setChainState(hash as `0x${string}`, { receipt: null, known: true });

    const result = await second.orchestrator.reconcileInFlight();

    expect(result.outcome).toBe("pending");
    expect(inFlightHash(second.orchestrator.getRun())).toBe(hash);
  });

  it("clears a dropped transaction so the step is signed again", async () => {
    const { first, hash } = await pausedMidFlight();
    const second = reload(first);
    second.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] });
    second.gateway.setChainState(hash as `0x${string}`, { receipt: null, known: false });

    const result = await second.orchestrator.reconcileInFlight();

    expect(result.outcome).toBe("dropped");
    // Back to pending: resume signs a fresh one rather than adopting a dead hash.
    expect(outcomeOf(second.orchestrator.getRun(), "a")).toEqual({ status: "pending" });
  });

  it("has nothing to reconcile when the run stopped at the wallet prompt", async () => {
    const first = harness({ scripts: [{ sign: "hold" }] });
    const running = first.start([step("a")]);
    await settle();
    first.orchestrator.pause();
    first.gateway.releaseSign();
    await running;
    // Roll storage back to the awaiting-signature write, as a tab closing
    // during the prompt would have left it.
    const persisted = first.store.load<TestSnapshot, TestCtx>("flow-1");
    if (!persisted) throw new Error("expected a persisted run");
    first.store.save<TestSnapshot, TestCtx>({
      ...persisted,
      steps: persisted.steps.map((entry) =>
        entry.stepId === "a" ? { ...entry, outcome: { status: "awaiting-signature" as const } } : entry,
      ),
    });

    const second = reload(first);
    second.orchestrator.restore({ flowId: "flow-1", steps: [step("a")] });

    // Not "none": a prompt was open, which is a different fact from nothing
    // happening. This step has no canSkip, so nothing can rule out a signature
    // that landed after the tab died, and the result says as much.
    expect(await second.orchestrator.reconcileInFlight()).toEqual({
      outcome: "unknown",
      stepId: "a",
      canSelfCheck: false,
    });
  });

  it("reports that a step with canSkip can answer the prompt question itself", async () => {
    const first = harness({ scripts: [{ sign: "hold" }] });
    const running = first.start([step("a")]);
    await settle();
    first.orchestrator.pause();
    first.gateway.releaseSign();
    await running;
    const persisted = first.store.load<TestSnapshot, TestCtx>("flow-1");
    if (!persisted) throw new Error("expected a persisted run");
    first.store.save<TestSnapshot, TestCtx>({
      ...persisted,
      steps: persisted.steps.map((entry) =>
        entry.stepId === "a" ? { ...entry, outcome: { status: "awaiting-signature" as const } } : entry,
      ),
    });

    const second = reload(first);
    second.orchestrator.restore({ flowId: "flow-1", steps: [step("a", { canSkip: () => false })] });

    expect(await second.orchestrator.reconcileInFlight()).toEqual({
      outcome: "unknown",
      stepId: "a",
      canSelfCheck: true,
    });
  });

  it("has nothing to reconcile with no run at all", async () => {
    expect(await harness().orchestrator.reconcileInFlight()).toEqual({ outcome: "none" });
  });
});

describe("preflight", () => {
  it("reports how stale the run is and what the chain says", async () => {
    const { first, hash } = await pausedMidFlight();
    const second = reload(first);
    second.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] });
    second.gateway.setChainState(hash as `0x${string}`, { receipt: "success", known: true });
    second.advance(2 * HOUR);

    const diff = await second.orchestrator.preflight();

    expect(diff.ageMs).toBe(2 * HOUR);
    expect(diff.reconcile.outcome).toBe("confirmed");
    expect(diff.completed.map((s) => s.stepId)).toEqual(["a"]);
    expect(diff.pending).toEqual([{ stepId: "b", label: "Step b", outcome: { status: "pending" } }]);
  });

  it("carries the adapter's re-quote into the diff the user decides on", async () => {
    const { first } = await pausedMidFlight();
    const second = harness({
      storage: first.storage,
      hooks: {
        onResume: () => ({
          staleWarning: "Prices moved while you were away.",
          changes: [{ label: "Villeneuve", before: "0.42", after: "0.47", changePct: 11.9 }],
        }),
      },
    });
    second.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] });

    const diff = await second.orchestrator.preflight();

    expect(diff.changes).toEqual([{ label: "Villeneuve", before: "0.42", after: "0.47", changePct: 11.9 }]);
    expect(second.events).toContainEqual({
      type: "resume:preflight",
      diff,
      staleWarning: "Prices moved while you were away.",
    });
  });

  it("lets the adapter re-plan what is left before anything is signed", async () => {
    const { first } = await pausedMidFlight();
    const second = harness({
      storage: first.storage,
      hooks: { onResume: () => ({ pending: [step("a"), step("b"), step("c")] }) },
    });
    second.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] });

    await second.orchestrator.preflight();

    expect(leftIds(second.orchestrator.getRun())).toEqual(["a", "b", "c"]);
    expect(second.gateway.signRequests).toEqual([]);
  });

  it("tells the adapter which transaction is still in flight, so a re-plan is a decision not a guess", async () => {
    const calls: OnResumeArgs[] = [];
    const { first, hash } = await pausedMidFlight();
    const second = harness({ storage: first.storage, hooks: { onResume: (args) => void calls.push(args) } });
    second.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] });
    second.gateway.setChainState(hash as `0x${string}`, { receipt: null, known: true });

    await second.orchestrator.preflight();

    expect(calls[0]?.inFlight).toEqual({ stepId: "a", hash });
  });

  it("says nothing is in flight once the transaction has been dropped", async () => {
    const calls: OnResumeArgs[] = [];
    const { first } = await pausedMidFlight();
    // A fresh gateway has never heard of the hash, so reconciliation drops it.
    const second = harness({ storage: first.storage, hooks: { onResume: (args) => void calls.push(args) } });
    second.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] });

    await second.orchestrator.preflight();

    expect(calls[0]?.inFlight).toBeUndefined();
  });

  it("keeps a transaction still in the mempool through a re-plan, rather than paying for it twice", async () => {
    const { first, hash } = await pausedMidFlight();
    const second = harness({
      storage: first.storage,
      // The adapter hands back a plan that still contains the step in flight.
      hooks: { onResume: () => ({ pending: [step("a"), step("b")] }) },
    });
    second.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] });
    second.gateway.setChainState(hash as `0x${string}`, { receipt: null, known: true });

    await second.orchestrator.preflight();

    expect(outcomeOf(second.orchestrator.getRun(), "a")).toMatchObject({ status: "submitted", hash });

    await second.orchestrator.resume();

    // Two steps, one signature: "a" was adopted rather than signed again.
    expect(second.gateway.signRequests).toHaveLength(1);
    expect(second.gateway.waitedOn[0]).toBe(hash);
  });

  it("tells the adapter how long the run sat, so it can judge staleness", async () => {
    const calls: OnResumeArgs[] = [];
    const { first } = await pausedMidFlight();
    const second = harness({ storage: first.storage, hooks: { onResume: (args) => void calls.push(args) } });
    const persisted = second.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] });

    await second.orchestrator.preflight();

    expect(calls[0]).toMatchObject({ persistedAt: persisted?.persistedAt });
  });
});

describe("resuming after a reload", () => {
  it("runs only what is left, and never signs a completed step again", async () => {
    const { first, hash } = await pausedMidFlight();
    const second = reload(first);
    second.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] });
    second.gateway.setChainState(hash as `0x${string}`, { receipt: "success", known: true });
    await second.orchestrator.preflight();

    await second.orchestrator.resume();

    expect(second.gateway.signRequests).toHaveLength(1);
    expect(doneIds(second.orchestrator.getRun())).toEqual(["a", "b"]);
    expect(second.orchestrator.getStatus()).toBe("completed");
  });

  it("adopts a transaction still in the mempool rather than paying for a second one", async () => {
    const { first, hash } = await pausedMidFlight();
    const second = reload(first);
    second.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] });
    second.gateway.setChainState(hash as `0x${string}`, { receipt: null, known: true });
    await second.orchestrator.preflight();

    await second.orchestrator.resume();

    // Two steps, but only one signature, step "a" was already broadcast.
    expect(second.gateway.signRequests).toHaveLength(1);
    expect(second.gateway.waitedOn[0]).toBe(hash);
    expect(second.orchestrator.getStatus()).toBe("completed");
  });

  it("clears storage once the resumed run finishes", async () => {
    const { first, hash } = await pausedMidFlight();
    const second = reload(first);
    second.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] });
    second.gateway.setChainState(hash as `0x${string}`, { receipt: "success", known: true });
    await second.orchestrator.preflight();

    await second.orchestrator.resume();

    expect(second.store.load("flow-1")).toBeNull();
    expect(second.scope.isFrozen()).toBe(false);
  });
});

/**
 * The resume gate reads the chain and rewrites step outcomes. Under a live loop
 * that overwrites the hash the driver is waiting on, so both calls belong
 * before a resume rather than during one.
 */
describe("the resume gate against a live run", () => {
  it("refuses to reconcile while the run is going", async () => {
    const h = harness({ scripts: [{ mine: "hold" }] });
    const running = h.start([step("a")]);
    await settle();

    await expect(h.orchestrator.reconcileInFlight()).rejects.toThrow(FlowStateError);
    await expect(h.orchestrator.preflight()).rejects.toThrow(FlowStateError);
    // The hash the driver is waiting on is untouched.
    expect(inFlightHash(h.orchestrator.getRun())).toBeDefined();

    h.gateway.releaseMine();
    await running;
  });
});

describe("starting over a run that is already stored", () => {
  it("refuses, rather than overwriting a transaction that is already on chain", async () => {
    const { first } = await pausedMidFlight();
    const second = reload(first);

    // A tab that never called listPersisted, just starting the flow again.
    await expect(second.start([step("a"), step("b")])).rejects.toThrow(/unfinished run is already stored/);
    expect(second.gateway.signRequests).toHaveLength(0);
    expect(persistedHash(second.store.load("flow-1"))).toBeDefined();
  });

  it("refuses over another adapter's record too, since they share the key", async () => {
    const theirs = harness({ adapterId: "someone-elses-flow", scripts: [{ mine: "hold" }] });
    const running = theirs.orchestrator.start({
      flowId: "shared-id",
      snapshot: { title: "Dune", deployed: [] },
      ctx: { chainId: 100, nonce: 1 },
      steps: [step("a")],
    });
    await settle(10);
    theirs.orchestrator.pause();
    theirs.gateway.releaseMine();
    await running;

    const mine = harness({ storage: theirs.storage });

    await expect(
      mine.orchestrator.start({
        flowId: "shared-id",
        snapshot: { title: "Mine", deployed: [] },
        ctx: { chainId: 100, nonce: 1 },
        steps: [step("a")],
      }),
    ).rejects.toThrow(/belongs to adapter/);
    // Their run, with its hash, is still there.
    expect(persistedHash(theirs.store.load("shared-id"))).toBeDefined();
    expect(mine.gateway.signRequests).toHaveLength(0);
  });

  it("lets the same flow start again once the stored run is discarded", async () => {
    const { first } = await pausedMidFlight();
    const second = reload(first);

    // Discarding without restoring first: the banner's "start over" button.
    second.orchestrator.trash("flow-1");
    expect(second.store.load("flow-1")).toBeNull();

    await second.start([step("a"), step("b")]);
    expect(second.orchestrator.getStatus()).toBe("completed");
  });

  it("says nothing when there is no run and no id to discard", () => {
    const h = harness();

    h.orchestrator.trash();

    // Announcing a discard here would have a banner report success over a
    // record that is still on disk.
    expect(h.types()).toEqual([]);
  });
});

describe("listPersisted", () => {
  it("leaves out runs belonging to another adapter, which restore would refuse", async () => {
    const theirs = harness({ adapterId: "someone-elses-flow", scripts: [{ mine: "hold" }] });
    const running = theirs.orchestrator.start({
      flowId: "their-flow",
      snapshot: { title: "Dune", deployed: [] },
      ctx: { chainId: 100, nonce: 1 },
      steps: [step("a")],
    });
    await settle();
    theirs.orchestrator.pause();
    theirs.gateway.releaseMine();
    await running;

    const mine = harness({ storage: theirs.storage });

    expect(mine.orchestrator.listPersisted()).toEqual([]);
    expect(() => mine.orchestrator.restore({ flowId: "their-flow", steps: [step("a")] })).toThrow(FlowStateError);
  });
});

describe("discarding a stored run", () => {
  it("refuses to discard a record belonging to another adapter", async () => {
    const theirs = harness({ adapterId: "someone-elses-flow", scripts: [{ mine: "hold" }] });
    const running = theirs.orchestrator.start({
      flowId: "their-flow",
      snapshot: { title: "Dune", deployed: [] },
      ctx: { chainId: 100, nonce: 1 },
      steps: [step("a")],
    });
    await settle(10);
    theirs.orchestrator.pause();
    theirs.gateway.releaseMine();
    await running;

    const mine = harness({ storage: theirs.storage });

    // start() and restore() both refuse this record; trash must not delete it.
    expect(() => mine.orchestrator.trash("their-flow")).toThrow(FlowStateError);
    expect(mine.store.load("their-flow")).not.toBeNull();
  });

  it("refuses to discard one id while a different run is restored", async () => {
    const { first } = await pausedMidFlight();
    const back = reload(first);
    back.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] });

    expect(() => back.orchestrator.trash("some-other-flow")).toThrow(FlowStateError);
    expect(back.store.load("flow-1")).not.toBeNull();
  });
});

describe("trash with an id that is not there", () => {
  it("says nothing, the same as trashing with nothing at all", () => {
    const h = harness();

    h.orchestrator.trash("never-existed");

    expect(h.types()).toEqual([]);
  });
});

describe("a step the chain confirmed while the tab was away", () => {
  it("still teaches the adapter what its receipt held", async () => {
    // The session-create shape: a parent whose receipt carries the id every
    // later step builds against. Losing it here fails a run whose transaction
    // succeeded, and starting over signs the parent a second time.
    const learns: FlowHooks<TestSnapshot, TestCtx> = {
      afterStep: ({ receipt }) => (receipt ? { snapshotPatch: { deployed: ["id-from-receipt"] } } : undefined),
    };
    const child = step("child", {
      build: (_ctx, snap) => {
        if (snap.deployed.length === 0) throw new Error("The id is not known yet.");
        return { to: "0x0000000000000000000000000000000000000001" as const };
      },
    });

    const first = harness({ scripts: [{ mine: "hold" }], hooks: learns });
    const running = first.start([step("parent"), child]);
    await settle(10);
    first.orchestrator.pause();
    first.gateway.releaseMine();
    await running;
    const hash = persistedHash(first.store.load("flow-1"));

    const second = harness({ storage: first.storage, hooks: learns });
    second.orchestrator.restore({ flowId: "flow-1", steps: [step("parent"), child] });
    second.gateway.setChainState(hash as `0x${string}`, { receipt: "success", known: true });

    await second.orchestrator.preflight();
    expect(second.orchestrator.getRun()?.snapshot.deployed).toEqual(["id-from-receipt"]);

    await second.orchestrator.resume();
    expect(second.orchestrator.getStatus()).toBe("completed");
  });
});

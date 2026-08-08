import { describe, expect, it, vi } from "vitest";

import { FlowStateError } from "../errors";
import { planned } from "../steps";
import type { TxStep } from "../types";
import {
  doneEntries,
  doneIds,
  harness,
  inFlightHash,
  leftIds,
  outcomeOf,
  settle,
  step,
  TX,
  type TestCtx,
  type TestSnapshot,
} from "./support/harness";

/**
 * The core promise of the runner: steps happen in order, exactly once, one
 * wallet prompt at a time, and the run's state always says truthfully where it
 * got to.
 */
describe("running a flow", () => {
  it("runs every step in order and completes", async () => {
    const h = harness();

    await h.start([step("a"), step("b"), step("c")]);

    expect(h.orchestrator.getStatus()).toBe("completed");
    expect(doneIds(h.orchestrator.getRun())).toEqual(["a", "b", "c"]);
    expect(h.gateway.signRequests).toHaveLength(3);
  });

  it("emits the lifecycle a stepper renders from", async () => {
    const h = harness();

    await h.start([step("a"), step("b")]);

    expect(h.types()).toEqual([
      "flow:started",
      "step:pending",
      "step:submitted",
      "step:confirmed",
      "step:pending",
      "step:submitted",
      "step:confirmed",
      "flow:completed",
    ]);
  });

  it("numbers steps for the UI", async () => {
    const h = harness();

    await h.start([step("a"), step("b"), step("c")]);

    expect(h.events.filter((e) => e.type === "step:pending")).toEqual([
      { type: "step:pending", stepId: "a", label: "Step a", index: 0, total: 3 },
      { type: "step:pending", stepId: "b", label: "Step b", index: 1, total: 3 },
      { type: "step:pending", stepId: "c", label: "Step c", index: 2, total: 3 },
    ]);
  });

  it("prompts for one signature at a time, never queues two wallet popups", async () => {
    const h = harness({ scripts: [{ sign: "hold" }] });

    const running = h.start([step("a"), step("b"), step("c")]);
    await settle();

    expect(h.gateway.signRequests).toHaveLength(1);

    h.gateway.releaseSign();
    await running;

    expect(h.gateway.signRequests).toHaveLength(3);
  });

  it("records the confirmed hash and block for each step", async () => {
    const h = harness();

    await h.start([step("a")]);

    expect(doneEntries(h.orchestrator.getRun())[0]).toEqual({
      stepId: "a",
      label: "Step a",
      outcome: {
        status: "confirmed",
        hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        blockNumber: 19_000_000n,
      },
    });
  });

  it("builds each transaction fresh, against the snapshot as it stands then", async () => {
    const build = vi.fn<TxStep<TestSnapshot, TestCtx>["build"]>(() => TX);
    const h = harness({
      hooks: {
        afterStep: ({ snapshot }) => ({ snapshotPatch: { deployed: [...snapshot.deployed, "parent"] } }),
      },
    });

    await h.start([step("a", { build }), step("b", { build })]);

    expect(build.mock.calls[0]?.[1]).toMatchObject({ deployed: [] });
    expect(build.mock.calls[1]?.[1]).toMatchObject({ deployed: ["parent"] });
  });

  it("skips a step whose work is already done, without touching the wallet", async () => {
    const h = harness();

    await h.start([step("approve", { canSkip: () => true }), step("deploy")]);

    expect(h.gateway.signRequests).toHaveLength(1);
    expect(doneEntries(h.orchestrator.getRun())).toEqual([
      { stepId: "approve", label: "Step approve", outcome: { status: "skipped" } },
      expect.objectContaining({ stepId: "deploy", outcome: expect.objectContaining({ status: "confirmed" }) }),
    ]);
    expect(h.types()).toContain("step:skipped");
  });

  it("freezes external updates while running and lets go once complete", async () => {
    const h = harness({ scripts: [{ sign: "hold" }] });

    const running = h.start([step("a")]);
    await settle();
    expect(h.scope.isFrozen()).toBe(true);

    h.gateway.releaseSign();
    await running;

    expect(h.scope.isFrozen()).toBe(false);
  });

  it("accepts steps enqueued after the run began, for an adapter that plans lazily", async () => {
    const h = harness({
      hooks: {
        afterStep: ({ completed, pending }) =>
          completed.stepId === "a" ? { pending: [...pending, step("late")] } : undefined,
      },
    });

    await h.start([step("a")]);

    expect(doneIds(h.orchestrator.getRun())).toEqual(["a", "late"]);
  });

  it("appends enqueued steps to what is left, leaving completed work alone", async () => {
    const h = harness();
    h.orchestrator.on("step:confirmed", ({ type }) => {
      if (type === "step:confirmed" && doneIds(h.orchestrator.getRun()).length === 1) {
        h.orchestrator.enqueue([step("c")]);
      }
    });

    await h.start([step("a"), step("b")]);

    expect(doneIds(h.orchestrator.getRun())).toEqual(["a", "b", "c"]);
  });

  it("replaces what is left without disturbing what already ran", async () => {
    const h = harness();
    h.orchestrator.on("step:confirmed", () => {
      if (doneIds(h.orchestrator.getRun()).length === 1) {
        h.orchestrator.replacePending([step("requoted")]);
      }
    });

    await h.start([step("a"), step("b"), step("c")]);

    expect(doneIds(h.orchestrator.getRun())).toEqual(["a", "requoted"]);
  });

  it("keeps a broadcast transaction when the pending plan is swapped under it", async () => {
    const h = harness({ scripts: [{ mine: "hold" }] });
    const running = h.start([step("a"), step("b")]);
    await settle();
    const inFlight = inFlightHash(h.orchestrator.getRun());

    h.orchestrator.replacePending([step("a"), step("c")]);

    expect(outcomeOf(h.orchestrator.getRun(), "a")).toMatchObject({ status: "submitted", hash: inFlight });
    expect(leftIds(h.orchestrator.getRun())).toEqual(["a", "c"]);

    h.gateway.releaseMine();
    await running;
  });

  it("refuses to queue steps when no run is active", () => {
    const h = harness();

    expect(() => h.orchestrator.enqueue([step("a")])).toThrow(FlowStateError);
    expect(() => h.orchestrator.replacePending([step("a")])).toThrow(FlowStateError);
  });

  it("refuses to queue steps onto a run that already finished", async () => {
    const h = harness();
    await h.start([step("a")]);

    expect(() => h.orchestrator.enqueue([step("b")])).toThrow(FlowStateError);
    expect(() => h.orchestrator.replacePending([step("b")])).toThrow(FlowStateError);
  });
});

/**
 * Ids are how a plan is matched back to a run, on a re-plan and on a restore.
 * A repeated one either does work twice or silently drops it, and both are paid
 * for in real transactions.
 */
describe("step ids", () => {
  it("refuses a plan that repeats an id, rather than silently running one of them", async () => {
    const h = harness();

    await expect(h.start([step("a"), step("a")])).rejects.toThrow(FlowStateError);
    expect(h.gateway.signRequests).toHaveLength(0);
  });

  it("refuses to enqueue an id the run already has", async () => {
    const h = harness({ scripts: [{ mine: "hold" }] });
    const running = h.start([step("a"), step("b")]);
    await settle();

    expect(() => h.orchestrator.enqueue([step("b")])).toThrow(FlowStateError);

    h.gateway.releaseMine();
    await running;
  });

  it("refuses a batch of enqueued steps that repeats an id inside itself", async () => {
    const h = harness({ scripts: [{ mine: "hold" }] });
    const running = h.start([step("a")]);
    await settle();

    // Clashing with the run and clashing with each other are the same problem.
    expect(() => h.orchestrator.enqueue([step("c"), step("c")])).toThrow(FlowStateError);
    expect(leftIds(h.orchestrator.getRun())).toEqual(["a"]);

    h.gateway.releaseMine();
    await running;
  });

  it("refuses a re-plan naming a step that already confirmed, rather than paying for it twice", async () => {
    const h = harness();
    let rejected: unknown;
    h.orchestrator.on("step:confirmed", () => {
      if (rejected) return;
      try {
        // "a" is mined and paid for. Naming it again would sign it a second time.
        h.orchestrator.replacePending([step("a"), step("b")]);
        rejected = "nothing thrown";
      } catch (error) {
        rejected = error;
      }
    });

    await h.start([step("a"), step("b")]);

    expect(rejected).toBeInstanceOf(FlowStateError);
    expect((rejected as Error).message).toMatch(/already been confirmed/);
    expect(doneIds(h.orchestrator.getRun())).toEqual(["a", "b"]);
    expect(h.gateway.signRequests).toHaveLength(2);
  });

  it("allows a re-plan naming a step that was skipped, since nothing was spent on it", async () => {
    const h = harness({ scripts: [{ mine: "hold" }] });
    const running = h.start([step("approve", { canSkip: () => true }), step("b")]);
    // The skip check costs a tick of its own before "b" reaches the chain.
    await settle(10);

    // A skipped approval can fairly come back: an allowance can be revoked.
    expect(() => h.orchestrator.replacePending([step("b"), step("approve")])).not.toThrow();

    h.gateway.releaseMine();
    await running;

    // The new attempt supersedes the skip rather than sitting beside it: one id
    // has to mean one entry, or every list keyed by stepId shows it twice.
    expect(doneIds(h.orchestrator.getRun())).toEqual(["b", "approve"]);
  });

  it("notifies subscribers on every state change, for useSyncExternalStore", async () => {
    const h = harness();
    const listener = vi.fn();
    h.orchestrator.subscribe(listener);

    await h.start([step("a")]);

    expect(listener).toHaveBeenCalled();
    // A snapshot for React must change identity when the run changes.
    expect(h.orchestrator.getRun()).not.toBe(null);
  });

  it("refuses to start a second run over a live one", async () => {
    const h = harness({ scripts: [{ sign: "hold" }] });
    const running = h.start([step("a")]);
    await settle();

    await expect(h.start([step("b")])).rejects.toThrow(FlowStateError);

    h.gateway.releaseSign();
    await running;
  });

  it("has no run before start and reports idle", () => {
    const h = harness();

    expect(h.orchestrator.getRun()).toBeNull();
    expect(h.orchestrator.getStatus()).toBe("idle");
  });
});

describe("the locked snapshot", () => {
  it("refuses a user edit once the run is live, amounts cannot move under a signature", async () => {
    const h = harness({ scripts: [{ sign: "hold" }] });
    const running = h.start([step("a")]);
    await settle();

    expect(() => h.orchestrator.updateSnapshot({ title: "changed" }, { source: "user" })).toThrow(FlowStateError);

    h.gateway.releaseSign();
    await running;
  });

  it("refuses a write straight through getRun, not only through the setter", async () => {
    const h = harness({ scripts: [{ sign: "hold" }] });
    const running = h.start([step("a")]);
    await settle();

    // Guarding updateSnapshot alone leaves the object itself open, and getRun
    // hands out the real one.
    const snapshot = h.orchestrator.getRun()?.snapshot;
    expect(() => {
      if (snapshot) snapshot.title = "written straight in";
    }).toThrow(TypeError);
    expect(h.orchestrator.getRun()?.snapshot.title).toBe("Dune");

    // Handed out live as well, and reordering it would reorder the queue the
    // driver is working through.
    const steps = h.orchestrator.getRun()?.steps;
    expect(() => steps?.push(planned(step("sneaked-in")))).toThrow(TypeError);
    expect(leftIds(h.orchestrator.getRun())).toEqual(["a"]);

    h.gateway.releaseSign();
    await running;
  });

  it("accepts a receipt-derived patch from the adapter and announces it", async () => {
    const h = harness({
      hooks: {
        afterStep: () => ({ snapshotPatch: { deployed: ["0xparent"] } }),
      },
    });

    await h.start([step("a")]);

    expect(h.orchestrator.getRun()?.snapshot).toEqual({ title: "Dune", deployed: ["0xparent"] });
    expect(h.events).toContainEqual({
      type: "snapshot:updated",
      snapshot: { title: "Dune", deployed: ["0xparent"] },
      source: "receipt",
    });
  });

  it("does not call a patch receipt-derived when the step was skipped", async () => {
    const h = harness({
      hooks: { afterStep: () => ({ snapshotPatch: { deployed: ["already-there"] } }) },
    });

    await h.start([step("approve", { canSkip: () => true })]);

    // `afterStep` runs for a skip too, with a null receipt. Labelling that
    // "receipt" tells a reader the numbers came off a transaction.
    expect(h.events).toContainEqual({
      type: "snapshot:updated",
      snapshot: { title: "Dune", deployed: ["already-there"] },
      source: "adapter",
    });
  });

  it("accepts a re-quote mid-run and says where it came from", async () => {
    const h = harness();
    h.orchestrator.on("step:confirmed", () => {
      h.orchestrator.updateSnapshot({ title: "Dune (re-quoted)" }, { source: "requote" });
    });

    await h.start([step("a")]);

    expect(h.orchestrator.getRun()?.snapshot.title).toBe("Dune (re-quoted)");
    expect(h.events).toContainEqual({
      type: "snapshot:updated",
      snapshot: { title: "Dune (re-quoted)", deployed: [] },
      source: "requote",
    });
  });

  it("takes a function patch, so an adapter can fold into what is already there", async () => {
    const h = harness({
      hooks: {
        afterStep: ({ completed }) => ({
          snapshotPatch: (prev: TestSnapshot) => ({ ...prev, deployed: [...prev.deployed, completed.stepId] }),
        }),
      },
    });

    await h.start([step("a"), step("b")]);

    expect(h.orchestrator.getRun()?.snapshot.deployed).toEqual(["a", "b"]);
  });
});

import { describe, expect, it } from "vitest";

import { FlowStateError } from "../errors";
import {
  doneIds,
  harness,
  inFlightHash,
  leftIds,
  outcomeOf,
  persistedIds,
  reasonOf,
  settle,
  step,
} from "./support/harness";

/**
 * Stopping a flow has two very different meanings, and conflating them loses
 * money: `pause` steps back from work that is still valid, `trash` throws it
 * away. Neither may leave a broadcast transaction unaccounted for.
 */
describe("pause", () => {
  it("stops watching a broadcast transaction at once, without waiting for it to mine", async () => {
    const h = harness({ scripts: [{ mine: "hold" }] });
    const running = h.start([step("a"), step("b")]);
    await settle();

    h.orchestrator.pause();
    await running;

    const run = h.orchestrator.getRun();
    expect(run?.status).toBe("paused");
    expect(reasonOf(run)).toBe("requested");
    // The hash is kept: that transaction is still out there.
    expect(outcomeOf(run, "a")).toMatchObject({ status: "submitted" });
    expect(doneIds(run)).toEqual([]);
  });

  it("leaves an open wallet prompt alone, then stops once the hash is safe", async () => {
    const h = harness({ scripts: [{ sign: "hold" }] });
    const running = h.start([step("a"), step("b")]);
    await settle();

    h.orchestrator.pause();
    // Aborting the prompt could hide a signature that still lands, so the
    // request is left to finish.
    h.gateway.releaseSign();
    await running;

    expect(h.gateway.signRequests).toHaveLength(1);
    expect(outcomeOf(h.orchestrator.getRun(), "a")).toMatchObject({ status: "submitted" });
    // Stopped at the checkpoint, it never started waiting on the receipt.
    expect(h.gateway.waitedOn).toEqual([]);
  });

  it("stops before the next signature rather than mid-step", async () => {
    const h = harness();
    h.orchestrator.on("step:confirmed", () => h.orchestrator.pause());

    await h.start([step("a"), step("b")]);

    expect(h.gateway.signRequests).toHaveLength(1);
    expect(doneIds(h.orchestrator.getRun())).toEqual(["a"]);
    expect(leftIds(h.orchestrator.getRun())).toEqual(["b"]);
  });

  it("keeps the screen frozen while paused, the run still owns it", async () => {
    const h = harness();
    h.orchestrator.on("step:confirmed", () => h.orchestrator.pause());

    await h.start([step("a"), step("b")]);

    expect(h.scope.isFrozen()).toBe(true);
  });

  it("survives a reload as a resumable run", async () => {
    const h = harness();
    h.orchestrator.on("step:confirmed", () => h.orchestrator.pause());

    await h.start([step("a"), step("b")]);

    expect(h.store.load("flow-1")).toMatchObject({ status: "paused", reason: "requested" });
    expect(persistedIds(h.store.load("flow-1"))).toEqual({ done: ["a"], left: ["b"] });
  });

  it("resumes where it stopped, never re-running what is already on chain", async () => {
    const h = harness();
    const unsubscribe = h.orchestrator.on("step:confirmed", () => h.orchestrator.pause());

    await h.start([step("a"), step("b"), step("c")]);
    unsubscribe();
    await h.orchestrator.resume();

    expect(h.gateway.signRequests).toHaveLength(3);
    expect(doneIds(h.orchestrator.getRun())).toEqual(["a", "b", "c"]);
    expect(h.orchestrator.getStatus()).toBe("completed");
  });

  it("adopts the transaction already in flight instead of signing a second one", async () => {
    const h = harness({ scripts: [{ mine: "hold" }] });
    const running = h.start([step("a")]);
    await settle();
    h.orchestrator.pause();
    await running;
    const inFlight = inFlightHash(h.orchestrator.getRun());

    const resumed = h.orchestrator.resume();
    await settle();
    // As if it mined while we were away.
    h.gateway.releaseMine();
    await resumed;

    expect(h.gateway.signRequests).toHaveLength(1);
    // Waited on the very same transaction, rather than broadcasting another.
    expect(h.gateway.waitedOn).toEqual([inFlight, inFlight]);
    expect(h.orchestrator.getStatus()).toBe("completed");
  });

  it("does nothing when there is no run to pause", () => {
    const h = harness();

    expect(() => h.orchestrator.pause()).not.toThrow();
    expect(h.orchestrator.getStatus()).toBe("idle");
  });
});

describe("trash", () => {
  it("discards the run and its storage", async () => {
    const h = harness({ scripts: [{ mine: "hold" }] });
    const running = h.start([step("a")]);
    await settle();

    h.orchestrator.trash();
    await running;

    expect(h.orchestrator.getRun()).toBeNull();
    expect(h.orchestrator.getStatus()).toBe("idle");
    expect(h.store.load("flow-1")).toBeNull();
    expect(h.scope.isFrozen()).toBe(false);
  });

  it("reports the transaction it walked away from, it is still on chain", async () => {
    const h = harness({ scripts: [{ mine: "hold" }] });
    const running = h.start([step("a")]);
    await settle();
    const inFlight = inFlightHash(h.orchestrator.getRun());

    h.orchestrator.trash();
    await running;

    expect(h.events).toContainEqual({ type: "flow:trashed", abandoned: inFlight });
  });

  it("has nothing to report when the wallet prompt was still open", async () => {
    const h = harness({ scripts: [{ sign: "hold" }] });
    const running = h.start([step("a")]);
    await settle();

    h.orchestrator.trash();
    await running;

    // No hash exists yet, so there is nothing to report walking away from.
    expect(h.events).toContainEqual({ type: "flow:trashed" });
  });

  it("stops the flow dead, no further steps are signed", async () => {
    const h = harness({ scripts: [{ mine: "hold" }] });
    const running = h.start([step("a"), step("b"), step("c")]);
    await settle();

    h.orchestrator.trash();
    h.gateway.releaseMine();
    await running;
    await settle();

    expect(h.gateway.signRequests).toHaveLength(1);
  });

  it("clears the way for a new run", async () => {
    const h = harness({ scripts: [{ mine: "hold" }] });
    const running = h.start([step("a")]);
    await settle();
    h.orchestrator.trash();
    await running;

    await h.start([step("b")]);

    expect(h.orchestrator.getStatus()).toBe("completed");
  });

  it("is harmless with no run at all", () => {
    const h = harness();

    expect(() => h.orchestrator.trash()).not.toThrow();
  });
});

describe("guarding the lifecycle", () => {
  it("refuses to start over a paused run, it must be resumed or trashed first", async () => {
    const h = harness({ scripts: [{ sign: "reject" }] });
    await h.start([step("a")]);

    await expect(h.start([step("b")])).rejects.toThrow(FlowStateError);
  });

  it("refuses to resume a run that already finished", async () => {
    const h = harness();
    await h.start([step("a")]);

    await expect(h.orchestrator.resume()).rejects.toThrow(FlowStateError);
  });

  it("refuses to resume when there is nothing to resume", async () => {
    const h = harness();

    await expect(h.orchestrator.resume()).rejects.toThrow(FlowStateError);
  });

  it("announces the resume before prompting, so the UI can show it", async () => {
    const h = harness({ scripts: [{ sign: "reject" }] });
    await h.start([step("a")]);

    await h.orchestrator.resume();

    expect(h.types()).toContain("flow:resuming");
    expect(h.types().indexOf("flow:resuming")).toBeLessThan(h.types().lastIndexOf("step:pending"));
  });

  it("leaves nothing of the old phase behind when the run moves on", async () => {
    const h = harness({ scripts: [{ sign: "reject" }] });
    await h.start([step("a")]);
    expect(reasonOf(h.orchestrator.getRun())).toBe("rejected");

    await h.orchestrator.resume();

    // The type says a completed run has no reason and no error. Carrying the
    // old ones forward would leave that a claim rather than a fact, and only a
    // key check can tell: the union hides them from anything typed.
    const run = h.orchestrator.getRun();
    expect(run?.status).toBe("completed");
    expect(Object.keys(run ?? {})).not.toContain("reason");
    expect(Object.keys(run ?? {})).not.toContain("error");
  });
});

describe("dispose", () => {
  it("lets go of the screen without discarding the run", async () => {
    const h = harness({ scripts: [{ mine: "hold" }] });
    const running = h.start([step("a"), step("b")]);
    await settle(10);

    h.orchestrator.dispose();
    h.gateway.releaseMine();
    await running;

    // The hold is gone and the loop has stopped, but the record survives so a
    // later instance can pick the run back up.
    expect(h.scope.isFrozen()).toBe(false);
    expect(h.orchestrator.getStatus()).toBe("idle");
    expect(h.gateway.signRequests).toHaveLength(1);
    expect(h.store.load("flow-1")).not.toBeNull();
    expect(h.types()).not.toContain("flow:trashed");
  });

  it("leaves a shared scope frozen for whoever else still holds it", async () => {
    const mine = harness({ scripts: [{ mine: "hold" }] });
    const running = mine.start([step("a")]);
    await settle(10);
    // A second flow on the same screen.
    mine.scope.freeze("another-flow", "Depositing");

    mine.orchestrator.dispose();

    expect(mine.scope.isFrozen()).toBe(true);
    expect(mine.scope.reason()).toBe("Depositing");

    mine.gateway.releaseMine();
    await running;
  });
});

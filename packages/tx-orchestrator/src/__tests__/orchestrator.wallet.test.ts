import { HttpRequestError } from "viem";
import { describe, expect, it, vi } from "vitest";

import type { TxStep } from "../types";
import {
  doneEntries,
  doneIds,
  errorOf,
  harness,
  inFlightHash,
  leftIds,
  outcomeOf,
  persistedHash,
  reasonOf,
  settle,
  step,
  TX,
  type TestCtx,
  type TestSnapshot,
} from "./support/harness";

/** The real one: a hand-built stand-in would pass long after viem had moved. */
const TRANSIENT = new HttpRequestError({ url: "https://rpc.example", status: 503 });

/**
 * Every wallet edge case. These are the ones that decide whether someone pays
 * for the same transaction twice, or believes work happened that never did.
 */
describe("when the wallet declines", () => {
  it("pauses without a hash and leaves the step to be done", async () => {
    const h = harness({ scripts: [{ sign: "reject" }] });

    await h.start([step("a"), step("b")]);

    const run = h.orchestrator.getRun();
    expect(run?.status).toBe("paused");
    expect(reasonOf(run)).toBe("rejected");
    expect(doneIds(run)).toEqual([]);
    expect(leftIds(run)).toEqual(["a", "b"]);
    // Nothing was broadcast, so there is nothing to reconcile later.
    expect(outcomeOf(run, "a")).toEqual({ status: "pending" });
  });

  it("resumes by rebuilding the same step, so it picks up a fresh nonce and gas", async () => {
    const build = vi.fn<TxStep<TestSnapshot, TestCtx>["build"]>(() => TX);
    const h = harness({ scripts: [{ sign: "reject" }] });

    await h.start([step("a", { build })]);
    await h.orchestrator.resume();

    expect(build).toHaveBeenCalledTimes(2);
    expect(h.gateway.signRequests).toHaveLength(2);
    expect(h.orchestrator.getStatus()).toBe("completed");
  });

  it("records the reason in a form a UI can show", async () => {
    const h = harness({ scripts: [{ sign: "reject" }] });

    await h.start([step("a")]);

    expect(errorOf(h.orchestrator.getRun())).toEqual({
      stepId: "a",
      message: "User rejected the request.",
      cause: "rejected",
    });
  });
});

describe("when the wallet speeds a transaction up", () => {
  it("follows the replacement hash instead of asking for a second signature", async () => {
    const h = harness({ scripts: [{ replacedBy: "repriced" }] });

    await h.start([step("a")]);

    expect(h.gateway.signRequests).toHaveLength(1);
    expect(h.orchestrator.getStatus()).toBe("completed");
    expect(h.types()).toContain("step:replaced");
  });

  it("confirms the step against the replacement, not the hash that no longer exists", async () => {
    const h = harness({ scripts: [{ replacedBy: "repriced" }] });

    await h.start([step("a")]);

    const replaced = h.events.find((e) => e.type === "step:replaced");
    expect(replaced).toMatchObject({ stepId: "a", reason: "repriced" });
    expect(doneEntries(h.orchestrator.getRun())[0]?.outcome).toMatchObject({
      hash: replaced?.type === "step:replaced" ? replaced.to : undefined,
    });
  });

  it("persists the new hash the moment it appears, before it mines", async () => {
    const h = harness({ scripts: [{ replacedBy: "repriced" }] });
    let persistedAtReplacement: string | undefined;

    h.orchestrator.on("step:replaced", () => {
      persistedAtReplacement = persistedHash(h.store.load("flow-1"));
    });

    await h.start([step("a")]);

    const replaced = h.events.find((e) => e.type === "step:replaced");
    // A tab closing between the speed-up and the mine must not leave the dead
    // hash on disk, reconciliation would call the step dropped.
    expect(persistedAtReplacement).toBe(replaced?.type === "step:replaced" ? replaced.to : "no event");
  });
});

describe("when the wallet cancels a transaction", () => {
  it("does not treat the cancel as the step being done", async () => {
    const h = harness({ scripts: [{ replacedBy: "cancelled" }] });

    await h.start([step("a"), step("b")]);

    const run = h.orchestrator.getRun();
    expect(doneIds(run)).toEqual([]);
    expect(leftIds(run)).toEqual(["a", "b"]);
    expect(reasonOf(run)).toBe("cancelled");
    expect(errorOf(run)?.message).toBe("The transaction was cancelled in the wallet.");
    // The cause is a wallet cancellation, not a declined prompt.
    expect(errorOf(run)?.cause).toBe("cancelled");
  });

  it("stops just as firmly when an unrelated transaction takes the nonce", async () => {
    const h = harness({ scripts: [{ replacedBy: "replaced" }] });

    await h.start([step("a")]);

    expect(reasonOf(h.orchestrator.getRun())).toBe("cancelled");
    expect(doneIds(h.orchestrator.getRun())).toEqual([]);
  });

  it("can be resumed, a cancel is a change of mind, not a dead end", async () => {
    const h = harness({ scripts: [{ replacedBy: "cancelled" }, {}] });

    await h.start([step("a")]);
    await h.orchestrator.resume();

    expect(h.orchestrator.getStatus()).toBe("completed");
    expect(h.gateway.signRequests).toHaveLength(2);
  });
});

describe("when the transaction reverts", () => {
  it("marks the run failed rather than quietly moving on", async () => {
    const h = harness({ scripts: [{ mine: "revert" }] });

    await h.start([step("a"), step("b")]);

    const run = h.orchestrator.getRun();
    expect(run?.status).toBe("failed");
    expect(errorOf(run)).toEqual({
      stepId: "a",
      message: "The transaction reverted on chain.",
      cause: "reverted",
      // Carried so the review screen can link the transaction that failed.
      hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
    });
    expect(doneIds(run)).toEqual([]);
    expect(h.gateway.signRequests).toHaveLength(1);
  });

  it("announces the failure as failed, not as a pause", async () => {
    const h = harness({ scripts: [{ mine: "revert" }] });

    await h.start([step("a")]);

    // A listener that saw "flow:paused" here would offer a resume button over a
    // run whose status is "failed".
    expect(h.types()).toContain("flow:failed");
    expect(h.types()).not.toContain("flow:paused");
    expect(h.events.at(-1)).toEqual({ type: "flow:failed", error: errorOf(h.orchestrator.getRun()) });
  });

  it("re-signs on resume rather than adopting the transaction that already reverted", async () => {
    const h = harness({ scripts: [{ mine: "revert" }, {}] });

    await h.start([step("a")]);
    await h.orchestrator.resume();

    expect(h.gateway.signRequests).toHaveLength(2);
    expect(h.orchestrator.getStatus()).toBe("completed");
  });
});

describe("when the node is flaky", () => {
  it("retries a receipt read and carries on", async () => {
    const h = harness({ scripts: [{ mine: { throws: TRANSIENT, attempts: 1 } }] });

    await h.start([step("a")]);

    expect(h.gateway.waitedOn).toHaveLength(2);
    expect(h.orchestrator.getStatus()).toBe("completed");
    // The retry is a read; the wallet was only ever asked once.
    expect(h.gateway.signRequests).toHaveLength(1);
  });

  it("backs off between reads rather than hammering a node that is struggling", async () => {
    const waits: number[] = [];
    const h = harness({
      scripts: [{ mine: { throws: TRANSIENT } }],
      sleep: async (ms) => void waits.push(ms),
      // Far enough to tell doubling from a linear climb, and to reach the cap.
      retryAttempts: 6,
    });

    await h.start([step("a")]);

    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 8_000]);
  });

  it("gives up after the retry budget and keeps the hash for later", async () => {
    const h = harness({ scripts: [{ mine: { throws: TRANSIENT } }], retryAttempts: 3 });

    await h.start([step("a")]);

    const run = h.orchestrator.getRun();
    expect(h.gateway.waitedOn).toHaveLength(3);
    // An RPC problem, so not "failed", the transaction may yet mine.
    expect(run?.status).toBe("paused");
    expect(errorOf(run)?.cause).toBe("rpc");
    expect(outcomeOf(run, "a")).toMatchObject({ status: "submitted" });
    expect(persistedHash(h.store.load("flow-1"))).toBe(inFlightHash(run));
  });

  it("stops during the backoff rather than starting another wait first", async () => {
    let releaseBackoff!: () => void;
    const backoff = new Promise<void>((resolve) => {
      releaseBackoff = resolve;
    });
    const h = harness({ scripts: [{ mine: { throws: TRANSIENT, attempts: 1 } }], sleep: () => backoff });

    const running = h.start([step("a")]);
    await settle(10);

    // The first read failed and the watcher is waiting out its backoff. There
    // is no live request to abort here, so the pause has to be noticed on the
    // way out of the sleep. A real wait can run for ten minutes.
    h.orchestrator.pause();
    releaseBackoff();
    await running;

    expect(h.gateway.waitedOn).toHaveLength(1);
    expect(h.orchestrator.getStatus()).toBe("paused");
    expect(reasonOf(h.orchestrator.getRun())).toBe("requested");
    // Still on chain, so resume adopts it rather than signing again.
    expect(outcomeOf(h.orchestrator.getRun(), "a")).toMatchObject({ status: "submitted" });
  });

  it("never retries a signature, a rejection is answered once", async () => {
    const h = harness({ scripts: [{ sign: { throws: TRANSIENT } }] });

    await h.start([step("a")]);

    expect(h.gateway.signRequests).toHaveLength(1);
    expect(h.orchestrator.getStatus()).toBe("paused");
  });
});

describe("when the step cannot be built", () => {
  it("stops before the wallet is ever opened", async () => {
    const h = harness();
    const build = () => {
      throw new Error("insufficient funds for gas * price + value");
    };

    await h.start([step("a", { build })]);

    expect(h.gateway.signRequests).toHaveLength(0);
    expect(h.orchestrator.getStatus()).toBe("failed");
    expect(errorOf(h.orchestrator.getRun())?.message).toContain("insufficient funds");
  });
});

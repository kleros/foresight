import { createMemoryStorage } from "@foresight/tx-orchestrator";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRedeemLock } from "../lock";
import { deferred, sharedLocks } from "./support/locks";
import { newWorld, progress, reached, REDEEM_AT, runs, settled, tab } from "./support/tabs";
import { rawStorage } from "./support/world";

afterEach(() => {
  for (const run of runs.splice(0)) run.dispose();
});

const FLOW = "redeem-session-4";

describe("redeem operations across tabs", () => {
  it.each(["start", "recover", "reset", "discard"] as const)(
    "%s cannot change the stored run while another tab's prompt is open",
    async (action) => {
      const world = newWorld();
      const storage = createMemoryStorage();
      const { locks } = sharedLocks();
      const a = tab(world, { storage, script: () => "hang", withLock: createRedeemLock(FLOW, locks) });
      const b = tab(world, { storage, withLock: createRedeemLock(FLOW, locks) });
      a.run.start();
      await a.sends.held();
      const before = rawStorage(storage);

      await b.run[action]();
      await reached(b.run, "halted");

      expect(progress(b.run).failure).toEqual({ reason: "elsewhere", retryable: true });
      expect(rawStorage(storage)).toBe(before);
      expect(b.sends.prompts).toEqual([]);
      expect(b.requests).toEqual([]);
    },
  );

  it("a blocked mount retries recovery after disposal without signing the held call again", async () => {
    const world = newWorld();
    const storage = createMemoryStorage();
    const { locks, held } = sharedLocks();
    const a = tab(world, { storage, script: () => "hang", withLock: createRedeemLock(FLOW, locks) });
    const b = tab(world, { storage, withLock: createRedeemLock(FLOW, locks) });
    a.run.start();
    await a.sends.held();
    b.run.recover();
    await reached(b.run, "halted");
    expect(progress(b.run).failure?.reason).toBe("elsewhere");
    const before = rawStorage(storage);
    for (let attempt = 0; attempt < 2; attempt++) {
      b.run.retry();
      await vi.waitFor(() => expect(progress(b.run).failure?.reason).toBe("elsewhere"));
      expect(rawStorage(storage)).toBe(before);
    }

    a.run.dispose();
    await vi.waitFor(() => expect(held.size).toBe(0));
    b.run.retry();
    await reached(b.run, "review");

    expect(b.sends.prompts).toEqual([]);
    b.run.resume();
    await reached(b.run, "halted");
    expect(progress(b.run).failure?.reason).toBe("held");
    expect(b.sends.prompts).toEqual([]);
  });

  it("two restored tabs resuming together open one redeem prompt", async () => {
    const world = newWorld();
    const storage = createMemoryStorage();
    const first = tab(world, {
      storage,
      script: (index) => (index === REDEEM_AT[0] ? "reject" : "sign"),
    });
    first.run.start();
    await settled(first.run);
    expect(progress(first.run).failure?.reason).toBe("rejected");
    first.run.dispose();
    const { locks, held } = sharedLocks();
    const a = tab(world, { storage, script: () => "hang", withLock: createRedeemLock(FLOW, locks) });
    const b = tab(world, { storage, script: () => "hang", withLock: createRedeemLock(FLOW, locks) });
    a.run.recover();
    await reached(a.run, "review");
    await vi.waitFor(() => expect(held.size).toBe(0));
    b.run.recover();
    await reached(b.run, "review");
    await vi.waitFor(() => expect(held.size).toBe(0));

    a.run.resume();
    b.run.resume();
    await a.sends.held();
    await reached(b.run, "halted");

    expect(a.sends.prompts).toHaveLength(1);
    expect(b.sends.prompts).toEqual([]);
    expect(progress(b.run).failure).toEqual({ reason: "elsewhere", retryable: true });
    a.run.dispose();
    await vi.waitFor(() => expect(held.size).toBe(0));
    b.run.retry();
    await reached(b.run, "review");
    expect(b.sends.prompts).toEqual([]);
  });

  it("retries a halted run's discard after another tab releases ownership", async () => {
    const world = newWorld();
    const storage = createMemoryStorage();
    const first = tab(world, { storage, script: () => "hang" });
    first.run.start();
    await first.sends.held();
    first.run.dispose();
    const { locks, held } = sharedLocks();
    const next = tab(world, { storage, withLock: createRedeemLock(FLOW, locks) });
    next.run.recover();
    await reached(next.run, "review");
    await vi.waitFor(() => expect(held.size).toBe(0));
    next.run.resume();
    await reached(next.run, "halted");
    expect(progress(next.run).failure?.reason).toBe("held");
    await vi.waitFor(() => expect(held.size).toBe(0));
    const open = deferred();
    const blocking = createRedeemLock(FLOW, locks)(() => open.promise, new AbortController().signal);
    await vi.waitFor(() => expect(held.size).toBe(1));

    await next.run.discard();
    expect(progress(next.run).failure?.reason).toBe("elsewhere");
    open.resolve();
    await blocking;
    next.run.retry();
    await reached(next.run, "idle");

    expect(rawStorage(storage)).toBe("");
    expect(next.sends.prompts).toEqual([]);
  });

  it("a restored tab cannot replace the batch id held by another tab's unanswered request", async () => {
    const world = newWorld();
    const storage = createMemoryStorage();
    const first = tab(world, { storage, atomic: true, sendCallsRefuse: 4001 });
    first.run.start();
    await settled(first.run);
    expect(progress(first.run).failure?.reason).toBe("rejected");
    first.run.dispose();
    const { locks, held } = sharedLocks();
    const a = tab(world, {
      storage,
      atomic: true,
      answer: (method) => (method === "wallet_sendCalls" ? new Promise(() => {}) : undefined),
      withLock: createRedeemLock(FLOW, locks),
    });
    const b = tab(world, { storage, atomic: true, withLock: createRedeemLock(FLOW, locks) });
    a.run.recover();
    await reached(a.run, "review");
    await vi.waitFor(() => expect(held.size).toBe(0));
    b.run.recover();
    await reached(b.run, "review");
    await vi.waitFor(() => expect(held.size).toBe(0));
    a.run.resume();
    await vi.waitFor(() => expect(a.requests.some(({ method }) => method === "wallet_sendCalls")).toBe(true));
    const before = rawStorage(storage);

    b.run.resume();
    await reached(b.run, "halted");

    expect(progress(b.run).failure).toEqual({ reason: "elsewhere", retryable: true });
    expect(rawStorage(storage)).toBe(before);
    expect(b.requests.filter(({ method }) => method === "wallet_sendCalls")).toEqual([]);
  });
});

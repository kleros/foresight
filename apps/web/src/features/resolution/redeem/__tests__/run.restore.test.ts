import { createMemoryStorage } from "@foresight/tx-orchestrator";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRedeemLock } from "../lock";
import { deferred, sharedLocks } from "./support/locks";
import { newWorld, progress, reached, REDEEM_AT, runs, settled, tab } from "./support/tabs";

afterEach(() => {
  vi.useRealTimers();
  for (const run of runs.splice(0)) run.dispose();
});

const FLOW = "redeem-session-4";

/** A rejected redeem leaves a stored run that a later mount restores for review. */
async function storedRun(world: ReturnType<typeof newWorld>, storage: ReturnType<typeof createMemoryStorage>) {
  const first = tab(world, { storage, script: (index) => (index === REDEEM_AT[0] ? "reject" : "sign") });
  first.run.start();
  await settled(first.run);
  expect(progress(first.run).failure?.reason).toBe("rejected");
  first.run.dispose();
}

describe("restoring a stored redeem on mount", () => {
  it("asks for no lock and shows nothing when no run is stored", async () => {
    const world = newWorld();
    const { locks, request } = sharedLocks();
    const b = tab(world, { storage: createMemoryStorage(), withLock: createRedeemLock(FLOW, locks) });

    b.run.restore();
    await Promise.resolve();

    expect(request).not.toHaveBeenCalled();
    expect(progress(b.run)).toMatchObject({ stage: "idle" });
    expect(progress(b.run).failure).toBeUndefined();
  });

  it("stays quiet while a remount still holds the lock, then shows the stored run once it is free", async () => {
    const world = newWorld();
    const storage = createMemoryStorage();
    await storedRun(world, storage);
    const { locks } = sharedLocks();
    const lock = createRedeemLock(FLOW, locks);
    const open = deferred();
    const holder = lock(() => open.promise, new AbortController().signal);
    const b = tab(world, { storage, withLock: lock });

    b.run.restore();
    await vi.waitFor(() => expect(locks.request).toHaveBeenCalledTimes(2));
    expect(progress(b.run).failure).toBeUndefined();
    expect(progress(b.run).stage).not.toBe("halted");

    open.resolve();
    await holder;
    await reached(b.run, "review");
    expect(b.sends.prompts).toEqual([]);
  });

  it("shows no another-tab stop when the lock stays held, and asks only once more", async () => {
    const world = newWorld();
    const storage = createMemoryStorage();
    await storedRun(world, storage);
    const { locks } = sharedLocks();
    const lock = createRedeemLock(FLOW, locks);
    const open = deferred();
    const holder = lock(() => open.promise, new AbortController().signal);
    const b = tab(world, { storage, withLock: lock });

    b.run.restore();
    await vi.waitFor(() => expect(locks.request).toHaveBeenCalledTimes(3), { timeout: 2_000 });
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(locks.request).toHaveBeenCalledTimes(3);
    expect(progress(b.run).failure).toBeUndefined();
    expect(b.sends.prompts).toEqual([]);
    open.resolve();
    await holder;
  });
});

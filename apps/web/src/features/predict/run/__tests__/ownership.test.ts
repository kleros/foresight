import { describe, expect, it } from "vitest";

import { createRunOwnership, type RunLocks } from "../ownership";

/**
 * A LockManager for one tab's view of the locks: `elsewhere` names those another tab holds.
 * jsdom has no Web Locks API, so the two methods used are written out here.
 */
function fakeLocks(elsewhere: string[] = []) {
  const ours = new Set<string>();
  const locks = {
    request: (async (name: string, _options: LockOptions, callback: (lock: Lock | null) => unknown) => {
      if (elsewhere.includes(name) || ours.has(name)) return callback(null);
      ours.add(name);
      try {
        return await callback({ name, mode: "exclusive" });
      } finally {
        ours.delete(name);
      }
    }) as RunLocks["request"],
    query: () =>
      Promise.resolve({
        held: [...elsewhere, ...ours].map((name) => ({ name, mode: "exclusive" as const, clientId: "" })),
        pending: [],
      }),
  } satisfies RunLocks;
  return { locks, ours };
}

const FLOW = "predict-100-0xowner-session";
const LOCK = `foresight.predict-run.${FLOW}`;

describe("createRunOwnership", () => {
  it("takes a run no other tab holds, and lets it go on release", async () => {
    const { locks, ours } = fakeLocks();
    const ownership = createRunOwnership(locks);

    const release = await ownership.claim(FLOW);
    expect(ours.has(LOCK)).toBe(true);
    release!();

    await expect.poll(() => ours.has(LOCK)).toBe(false);
  });

  it("answers null for a run another tab holds", async () => {
    const ownership = createRunOwnership(fakeLocks([LOCK]).locks);

    await expect(ownership.claim(FLOW)).resolves.toBeNull();
  });

  it("reports a run another tab holds as held elsewhere, and its own as not", async () => {
    const elsewhere = createRunOwnership(fakeLocks([LOCK]).locks);
    const here = createRunOwnership(fakeLocks().locks);
    await here.claim(FLOW);

    expect(await elsewhere.heldElsewhere(FLOW)).toBe(true);
    expect(await here.heldElsewhere(FLOW)).toBe(false);
  });

  it("takes the run as this tab's when the lock request is refused", async () => {
    const locks: RunLocks = {
      request: (() => Promise.reject(new DOMException("not fully active", "InvalidStateError"))) as RunLocks["request"],
      query: () => Promise.reject(new DOMException("opaque origin", "SecurityError")),
    };
    const ownership = createRunOwnership(locks);

    await expect(ownership.claim(FLOW)).resolves.toEqual(expect.any(Function));
    await expect(ownership.heldElsewhere(FLOW)).resolves.toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { createRunOwnership, type LeaseStorage, type RunLocks } from "../ownership";

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

  it("reads its own run as not held elsewhere while the lock manager is still letting it go", async () => {
    const { locks } = fakeLocks();
    const ownership = createRunOwnership(locks);

    const release = await ownership.claim(FLOW);
    release!();

    // asked in the same task, before the lock manager has taken the release
    expect(await ownership.heldElsewhere(FLOW)).toBe(false);
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

  it("reports a run this tab holds as held here, and no longer once it lets go", async () => {
    const ownership = createRunOwnership(fakeLocks().locks);

    const release = await ownership.claim(FLOW);
    expect(ownership.heldHere(FLOW)).toBe(true);
    release!();

    expect(ownership.heldHere(FLOW)).toBe(false);
  });
});

/** One origin's localStorage, shared by the tabs built on it. */
function sharedStorage() {
  const items = new Map<string, string>();
  const storage: LeaseStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
  return { storage, items };
}

const refusingLocks: RunLocks = {
  request: (() => Promise.reject(new DOMException("not fully active", "InvalidStateError"))) as RunLocks["request"],
  query: () => Promise.reject(new DOMException("opaque origin", "SecurityError")),
};

const LEASE = `foresight.predict-lease.${FLOW}`;

describe("createRunOwnership with no usable Web Locks", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["the lock request is refused", refusingLocks],
    ["there is no Web Locks API", null],
  ])("lets one tab at a time hold a run when %s", async (_case, locks) => {
    const { storage } = sharedStorage();
    const [a, b] = [createRunOwnership(locks, { storage }), createRunOwnership(locks, { storage })];

    const release = await a.claim(FLOW);
    expect(release).toEqual(expect.any(Function));
    await expect(b.claim(FLOW)).resolves.toBeNull();
    await expect(b.heldElsewhere(FLOW)).resolves.toBe(true);
    await expect(a.heldElsewhere(FLOW)).resolves.toBe(false);
    expect(a.heldHere(FLOW)).toBe(true);
    expect(b.heldHere(FLOW)).toBe(false);

    release!();
    expect(a.heldHere(FLOW)).toBe(false);
    await expect(b.heldElsewhere(FLOW)).resolves.toBe(false);
    await expect(b.claim(FLOW)).resolves.toEqual(expect.any(Function));
  });

  it("renews the lease while held, so a tab that stays open keeps the run past the lease's term", async () => {
    vi.useFakeTimers();
    const { storage } = sharedStorage();
    const [a, b] = [createRunOwnership(null, { storage }), createRunOwnership(null, { storage })];

    await a.claim(FLOW);
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    await expect(b.claim(FLOW)).resolves.toBeNull();
    await expect(b.heldElsewhere(FLOW)).resolves.toBe(true);
  });

  it("lets another tab take a lease that ran out unrenewed", async () => {
    const { storage, items } = sharedStorage();
    items.set(LEASE, JSON.stringify({ owner: "closed-tab", expiresAt: Date.now() - 1 }));
    const ownership = createRunOwnership(null, { storage });

    await expect(ownership.heldElsewhere(FLOW)).resolves.toBe(false);
    await expect(ownership.claim(FLOW)).resolves.toEqual(expect.any(Function));
    expect(JSON.parse(items.get(LEASE)!).owner).not.toBe("closed-tab");
  });

  it("leaves a lease that has not run out to the tab holding it", async () => {
    const { storage, items } = sharedStorage();
    items.set(LEASE, JSON.stringify({ owner: "open-tab", expiresAt: Date.now() + 60_000 }));
    const ownership = createRunOwnership(null, { storage });

    await expect(ownership.claim(FLOW)).resolves.toBeNull();
    await expect(ownership.heldElsewhere(FLOW)).resolves.toBe(true);
  });

  it("gives the lease up when the page is hidden for unload", async () => {
    const { storage, items } = sharedStorage();
    const page = new EventTarget();
    await createRunOwnership(null, { storage, page }).claim(FLOW);
    expect(items.has(LEASE)).toBe(true);

    page.dispatchEvent(new Event("pagehide"));

    expect(items.has(LEASE)).toBe(false);
    await expect(createRunOwnership(null, { storage }).heldElsewhere(FLOW)).resolves.toBe(false);
  });

  it("keeps a tab with working locks off a run another tab holds by lease", async () => {
    const { storage } = sharedStorage();
    await createRunOwnership(refusingLocks, { storage }).claim(FLOW);
    const withLocks = createRunOwnership(fakeLocks().locks, { storage });

    await expect(withLocks.claim(FLOW)).resolves.toBeNull();
    await expect(withLocks.heldElsewhere(FLOW)).resolves.toBe(true);
  });

  it("refuses the run and reports it held elsewhere when storage cannot be read either", async () => {
    const broken: LeaseStorage = {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    };

    for (const ownership of [createRunOwnership(refusingLocks, { storage: broken }), createRunOwnership(null)]) {
      await expect(ownership.claim(FLOW)).resolves.toBeNull();
      await expect(ownership.heldElsewhere(FLOW)).resolves.toBe(true);
    }
  });
});

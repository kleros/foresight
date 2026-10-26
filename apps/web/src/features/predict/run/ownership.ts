/** Which open tab is driving a stored run, so no other tab resumes, signs or discards it under it. */
export interface RunOwnership {
  /** Takes `flowId` for this tab and returns its release, or null while any tab, this one included, holds it. */
  claim(flowId: string): Promise<(() => void) | null>;
  /** Whether another open tab holds `flowId`, or whether that cannot be told. */
  heldElsewhere(flowId: string): Promise<boolean>;
  /** Whether this tab holds `flowId`. */
  heldHere(flowId: string): boolean;
}

/** The part of the Web Locks API used here; a lock is let go when its tab closes or crashes. */
export type RunLocks = Pick<LockManager, "request" | "query">;

/** The part of localStorage the lease fallback uses. */
export type LeaseStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface LeaseDeps {
  /** Shared by the origin's tabs; null, or one that throws, leaves no way to tell tabs apart. */
  storage?: LeaseStorage | null;
  /** Fires `pagehide` as the page is left. */
  page?: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
}

interface Lease {
  owner: string;
  /** ms since the epoch. */
  expiresAt: number;
}

/** Outlives hidden-tab timer clamping, which can hold a renewal back by a minute. */
const LEASE_MS = 90_000;
const RENEW_MS = 15_000;

const lockName = (flowId: string) => `foresight.predict-run.${flowId}`;
const leaseKey = (flowId: string) => `foresight.predict-lease.${flowId}`;

const UNREADABLE = Symbol("unreadable");

function newTabId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Web Locks first; where a request is refused or there is no API, a localStorage lease renewed while held.
 * With neither, every run reads as held elsewhere.
 */
export function createRunOwnership(
  locks: RunLocks | null,
  { storage = null, page = null }: LeaseDeps = {},
): RunOwnership {
  const tabId = newTabId();
  /** Runs this tab holds, by flowId. */
  const here = new Set<string>();
  /** Locks this tab has let go of that the lock manager may still list. */
  const lettingGo = new Set<string>();

  function readLease(flowId: string): Lease | null | typeof UNREADABLE {
    try {
      if (!storage) return UNREADABLE;
      const raw = storage.getItem(leaseKey(flowId));
      if (raw === null) return null;
      const lease = JSON.parse(raw) as Partial<Lease>;
      return typeof lease.owner === "string" && typeof lease.expiresAt === "number"
        ? { owner: lease.owner, expiresAt: lease.expiresAt }
        : null;
    } catch {
      return UNREADABLE;
    }
  }

  function writeLease(flowId: string): boolean {
    try {
      if (!storage) return false;
      storage.setItem(leaseKey(flowId), JSON.stringify({ owner: tabId, expiresAt: Date.now() + LEASE_MS }));
      return true;
    } catch {
      return false;
    }
  }

  const leasedElsewhere = (lease: Lease | null) =>
    lease !== null && lease.owner !== tabId && lease.expiresAt > Date.now();

  function dropLease(flowId: string) {
    try {
      const lease = readLease(flowId);
      if (lease !== UNREADABLE && lease?.owner === tabId) storage?.removeItem(leaseKey(flowId));
    } catch {
      // the lease runs out on its own
    }
  }

  function claimByLease(flowId: string): (() => void) | null {
    if (here.has(flowId)) return null;
    const lease = readLease(flowId);
    if (lease === UNREADABLE || leasedElsewhere(lease) || !writeLease(flowId)) return null;
    // localStorage has no compare-and-set; a tab writing in the same moment wins or loses on this read
    const written = readLease(flowId);
    if (written === UNREADABLE || written?.owner !== tabId) return null;

    here.add(flowId);
    const renew = setInterval(() => {
      const now = readLease(flowId);
      if (now !== UNREADABLE && !leasedElsewhere(now) && writeLease(flowId)) return;
      clearInterval(renew);
      here.delete(flowId);
    }, RENEW_MS);
    // a page restored from the back-forward cache writes the lease back on its next renewal
    const onPageHide = () => dropLease(flowId);
    page?.addEventListener("pagehide", onPageHide);

    return () => {
      clearInterval(renew);
      page?.removeEventListener("pagehide", onPageHide);
      if (!here.delete(flowId)) return;
      dropLease(flowId);
    };
  }

  function claimByLock(locks: RunLocks, flowId: string): Promise<(() => void) | null | typeof UNREADABLE> {
    const name = lockName(flowId);
    return new Promise((resolve) => {
      let held = false;
      locks
        .request(name, { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(null);
            return;
          }
          // a tab on the lease fallback holds it outside the lock manager
          const lease = readLease(flowId);
          if (lease !== UNREADABLE && leasedElsewhere(lease)) {
            resolve(null);
            return;
          }
          held = true;
          here.add(flowId);
          lettingGo.add(flowId);
          // the lock is held until this promise settles
          return new Promise<void>((letGo) => {
            resolve(() => {
              here.delete(flowId);
              letGo();
            });
          });
        })
        // the lock manager lists the lock until the request settles
        .then(() => {
          if (held) lettingGo.delete(flowId);
        })
        // a document that is not fully active, or an opaque origin, refuses locks
        .catch(() => resolve(UNREADABLE));
    });
  }

  return {
    async claim(flowId) {
      if (locks) {
        const answer = await claimByLock(locks, flowId);
        if (answer !== UNREADABLE) return answer;
      }
      return claimByLease(flowId);
    },

    async heldElsewhere(flowId) {
      const ours = () => here.has(flowId) || lettingGo.has(flowId);
      const oursBefore = ours();
      const listed = locks
        ? await locks
            .query()
            .then(({ held = [] }) => held.some((lock) => lock.name === lockName(flowId)))
            .catch(() => UNREADABLE)
        : UNREADABLE;
      if (oursBefore || ours()) return false;
      if (listed === true) return true;
      const lease = readLease(flowId);
      if (lease === UNREADABLE) return listed === UNREADABLE;
      return leasedElsewhere(lease);
    },

    heldHere: (flowId) => here.has(flowId),
  };
}

let tab: RunOwnership | undefined;

function tabStorage(): LeaseStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** This tab's ownership. */
export function tabOwnership(): RunOwnership {
  tab ??= createRunOwnership(typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null, {
    storage: tabStorage(),
    page: typeof window === "undefined" ? null : window,
  });
  return tab;
}

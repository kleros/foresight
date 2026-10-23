/** Which open tab is driving a stored run, so no other tab resumes, signs or discards it under it. */
export interface RunOwnership {
  /** Takes `flowId` for this tab and returns its release, or null while another tab holds it. */
  claim(flowId: string): Promise<(() => void) | null>;
  /** Whether another open tab holds `flowId`. */
  heldElsewhere(flowId: string): Promise<boolean>;
}

/** The part of the Web Locks API used here; a lock is let go when its tab closes or crashes. */
export type RunLocks = Pick<LockManager, "request" | "query">;

const lockName = (flowId: string) => `foresight.predict-run.${flowId}`;

export function createRunOwnership(locks: RunLocks | null): RunOwnership {
  /** Locks this tab holds; `query` lists every tab's, so ours are told apart here. */
  const here = new Set<string>();

  return {
    claim(flowId) {
      if (!locks) return Promise.resolve(() => {});
      const name = lockName(flowId);
      return new Promise((resolve) => {
        // a document that is not fully active, or an opaque origin, refuses locks; the run is then this tab's, as with no API
        locks.request(name, { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(null);
            return;
          }
          here.add(name);
          // the lock is held until this promise settles
          return new Promise<void>((letGo) => {
            resolve(() => {
              if (!here.delete(name)) return;
              letGo();
            });
          });
        }).catch(() => resolve(() => {}));
      });
    },

    async heldElsewhere(flowId) {
      if (!locks) return false;
      const name = lockName(flowId);
      // a lock this tab is letting go of can still be listed as the query answers
      const oursBefore = here.has(name);
      const { held = [] } = await locks.query().catch(() => ({ held: [] }));
      return !oursBefore && !here.has(name) && held.some((lock) => lock.name === name);
    },
  };
}

let tab: RunOwnership | undefined;

/** This tab's ownership; with no Web Locks API every run counts as this tab's. */
export function tabOwnership(): RunOwnership {
  tab ??= createRunOwnership(typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null);
  return tab;
}

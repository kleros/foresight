export class RedeemLockError extends Error {
  constructor(readonly reason: "elsewhere" | "storage") {
    super(reason);
    this.name = "RedeemLockError";
  }
}

/** localStorage cannot make a read and a write atomic across tabs. */
export function createRedeemLock(flowId: string, locks: Pick<LockManager, "request"> | undefined) {
  return async (work: () => Promise<void>, signal: AbortSignal): Promise<void> => {
    if (signal.aborted) return;
    if (!locks) throw new RedeemLockError("storage");
    let entered = false;
    try {
      await locks.request(`foresight.redeem-run.${flowId}`, { mode: "exclusive", ifAvailable: true }, async (lock) => {
        if (signal.aborted) return;
        if (!lock) throw new RedeemLockError("elsewhere");
        entered = true;
        let release!: () => void;
        const disposed = new Promise<void>((resolve) => {
          release = resolve;
        });
        signal.addEventListener("abort", release, { once: true });
        try {
          // A wallet prompt can outlive the component; dispose stops its driver before releasing this lock.
          await Promise.race([work(), disposed]);
        } finally {
          signal.removeEventListener("abort", release);
        }
      });
    } catch (error) {
      if (entered || error instanceof RedeemLockError) throw error;
      throw new RedeemLockError("storage");
    }
  };
}

import { describe, expect, it, vi } from "vitest";

import { createRedeemLock } from "../lock";
import { deferred, sharedLocks } from "./support/locks";

describe("redeem operation ownership", () => {
  it("refuses a competing operation without queuing it, then permits an explicit retry", async () => {
    const { locks, held } = sharedLocks();
    const first = createRedeemLock("same-session", locks);
    const second = createRedeemLock("same-session", locks);
    const open = deferred();
    const firstWork = vi.fn(() => open.promise);
    const secondWork = vi.fn(async () => {});
    const signal = new AbortController().signal;
    const running = first(firstWork, signal);
    await vi.waitFor(() => expect(firstWork).toHaveBeenCalledOnce());

    await expect(second(secondWork, signal)).rejects.toMatchObject({ reason: "elsewhere" });
    expect(secondWork).not.toHaveBeenCalled();
    expect(held.size).toBe(1);

    open.resolve();
    await running;
    expect(secondWork).not.toHaveBeenCalled();
    await second(secondWork, signal);
    expect(secondWork).toHaveBeenCalledOnce();
  });

  it("allows different sessions to proceed independently", async () => {
    const { locks } = sharedLocks();
    const open = deferred();
    const signal = new AbortController().signal;
    const running = createRedeemLock("first-session", locks)(() => open.promise, signal);
    const secondWork = vi.fn(async () => {});

    await createRedeemLock("second-session", locks)(secondWork, signal);

    expect(secondWork).toHaveBeenCalledOnce();
    open.resolve();
    await running;
  });

  it("releases ownership on disposal even while a wallet request never answers", async () => {
    const { locks, held } = sharedLocks();
    const abort = new AbortController();
    const work = vi.fn(() => new Promise<void>(() => {}));
    const running = createRedeemLock("same-session", locks)(work, abort.signal);
    await vi.waitFor(() => expect(work).toHaveBeenCalledOnce());

    abort.abort();
    await running.catch(() => {});

    expect(held.size).toBe(0);
    const nextWork = vi.fn(async () => {});
    await createRedeemLock("same-session", locks)(nextWork, new AbortController().signal);
    expect(nextWork).toHaveBeenCalledOnce();
  });

  it("does not run work whose owner was already disposed", async () => {
    const { locks } = sharedLocks();
    const abort = new AbortController();
    abort.abort();
    const work = vi.fn(async () => {});

    await createRedeemLock("same-session", locks)(work, abort.signal).catch(() => {});

    expect(work).not.toHaveBeenCalled();
  });

  it.each(["missing", "refused"] as const)("signs nothing when the browser lock API is %s", async (kind) => {
    const { locks } = sharedLocks();
    vi.spyOn(locks, "request").mockRejectedValue(new Error("The document is not active."));
    const work = vi.fn(async () => {});
    const withLock = createRedeemLock("same-session", kind === "missing" ? undefined : locks);

    await expect(withLock(work, new AbortController().signal)).rejects.toMatchObject({ reason: "storage" });

    expect(work).not.toHaveBeenCalled();
  });

  it("preserves an operation's failure and releases ownership", async () => {
    const { locks, held } = sharedLocks();
    const failure = new Error("The network did not answer.");

    await expect(
      createRedeemLock("same-session", locks)(() => Promise.reject(failure), new AbortController().signal),
    ).rejects.toBe(failure);

    expect(held.size).toBe(0);
  });
});

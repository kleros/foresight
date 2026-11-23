import { vi } from "vitest";

export function sharedLocks() {
  const held = new Set<string>();
  const request = vi.fn(
    async <T>(
      name: string,
      optionsOrCallback: LockOptions | LockGrantedCallback<T>,
      provided?: LockGrantedCallback<T>,
    ) => {
      const options = typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
      const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : provided!;
      if (options.ifAvailable !== true) throw new Error("The redeem lock must not queue wallet requests.");
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({ name, mode: "exclusive" });
      } finally {
        held.delete(name);
      }
    },
  );
  return { locks: { request } satisfies Pick<LockManager, "request">, request, held };
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

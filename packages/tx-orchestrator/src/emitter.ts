import type { Unsubscribe } from "./types";

function report(what: string, error: unknown): void {
  console.error(`[tx-orchestrator] ${what} threw and was ignored`, error);
}

/** An `async` listener rejects after the try has returned, so catch the thenable too. */
function safely(call: () => unknown, what: string): void {
  try {
    const result = call();
    if (typeof (result as PromiseLike<unknown> | undefined)?.then === "function") {
      void Promise.resolve(result).catch((error: unknown) => report(what, error));
    }
  } catch (error) {
    report(what, error);
  }
}

export interface Emitter<TEvent extends { type: string }> {
  emit(event: TEvent): void;
  on(type: TEvent["type"] | "*", handler: (event: TEvent) => void): Unsubscribe;
}

export function createEmitter<TEvent extends { type: string }>(): Emitter<TEvent> {
  const handlers = new Map<string, Set<(event: TEvent) => void>>();

  return {
    emit(event) {
      for (const handler of [...(handlers.get(event.type) ?? [])]) {
        safely(() => handler(event), `a "${event.type}" handler`);
      }
      for (const handler of [...(handlers.get("*") ?? [])]) {
        safely(() => handler(event), `a "*" handler for "${event.type}"`);
      }
    },

    on(type, handler) {
      const set = handlers.get(type) ?? new Set();
      set.add(handler);
      handlers.set(type, set);
      return () => void set.delete(handler);
    },
  };
}

export interface Notifier {
  notify(): void;
  subscribe(listener: () => void): Unsubscribe;
}

export function createNotifier(): Notifier {
  const listeners = new Set<() => void>();

  return {
    notify() {
      for (const listener of [...listeners]) safely(listener, "a change listener");
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

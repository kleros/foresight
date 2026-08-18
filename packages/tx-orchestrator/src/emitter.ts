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

/** The events of one type, so a handler is given what it subscribed to. */
export type EventOfType<TEvent extends { type: string }, TType extends TEvent["type"] | "*"> = TType extends "*"
  ? TEvent
  : Extract<TEvent, { type: TType }>;

export interface Emitter<TEvent extends { type: string }> {
  emit(event: TEvent): void;
  on<TType extends TEvent["type"] | "*">(
    type: TType,
    handler: (event: EventOfType<TEvent, TType>) => void,
  ): Unsubscribe;
}

export function createEmitter<TEvent extends { type: string }>(): Emitter<TEvent> {
  const handlers = new Map<string, Set<(event: never) => void>>();

  return {
    emit(event) {
      // The map is keyed by event type, so a handler only ever sees its own.
      const deliver = (handler: (event: never) => void) => handler(event as never);

      for (const handler of [...(handlers.get(event.type) ?? [])]) {
        safely(() => deliver(handler), `a "${event.type}" handler`);
      }
      for (const handler of [...(handlers.get("*") ?? [])]) {
        safely(() => deliver(handler), `a "*" handler for "${event.type}"`);
      }
    },

    on(type, handler) {
      const set = handlers.get(type) ?? new Set();
      set.add(handler as (event: never) => void);
      handlers.set(type, set);
      return () => void set.delete(handler as (event: never) => void);
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

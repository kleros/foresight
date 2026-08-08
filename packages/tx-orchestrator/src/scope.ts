import { createNotifier } from "./emitter";
import type { Unsubscribe } from "./types";

/**
 * An advisory lock saying "a transaction flow owns the screen right now".
 * Held per owner, so a shared scope stays frozen until the last one lets go.
 *
 * @dev Use it to enable/disable react-queries, refetch / pause balance fetching, etc
 */
export interface FlowScope {
  /** Takes the latch for `owner`. Freezing again as the same owner just updates the reason. */
  freeze(owner: string, reason: string): void;
  /** Releases `owner`'s hold. Others keep theirs. */
  unfreeze(owner: string): void;
  isFrozen(): boolean;
  /** The most recently frozen owner's reason. */
  reason(): string | null;
  subscribe(listener: () => void): Unsubscribe;
}

export function createFlowScope(): FlowScope {
  const held = new Map<string, string>();
  const changes = createNotifier();

  function currentReason(): string | null {
    let last: string | null = null;
    for (const reason of held.values()) last = reason;
    return last;
  }

  return {
    freeze(owner, reason) {
      const before = currentReason();
      // Re-inserting moves this owner to the back, so the newest reason shows.
      held.delete(owner);
      held.set(owner, reason);
      if (before !== reason) changes.notify();
    },

    unfreeze(owner) {
      // Notified even when others still hold it: the reason on show may change.
      if (held.delete(owner)) changes.notify();
    },

    isFrozen: () => held.size > 0,
    reason: currentReason,
    subscribe: changes.subscribe,
  };
}

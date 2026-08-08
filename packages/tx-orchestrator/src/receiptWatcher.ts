import type { Hash, TransactionReceipt } from "viem";

import { isRetryableRead } from "./errors";
import type { TxErrorCause, TxGateway, TxReplacement } from "./types";

export interface ReceiptWatcher {
  wait(args: {
    hash: Hash;
    /** The run-level signal. Aborting it gives up for good. */
    signal: AbortSignal;
    /** Fires the moment a replacement is seen, so the new hash can be persisted before it mines. */
    onReplaced: (replacement: TxReplacement) => void;
    /** Checked before a retry */
    giveUp: () => boolean;
  }): Promise<TransactionReceipt>;
  /** Aborts the current wait , not the run. */
  abort(): void;
}

export function createReceiptWatcher(opts: {
  gateway: TxGateway;
  confirmations?: number;
  classify: (error: unknown) => TxErrorCause;
  maxAttempts: number;
  delayMs: (attempt: number) => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}): ReceiptWatcher {
  const { gateway, confirmations, classify, maxAttempts, delayMs, sleep } = opts;

  /** The current attempt's own signal, so a pause cancels the wait and not the run. */
  let current: AbortController | null = null;

  return {
    async wait({ hash, signal, onReplaced, giveUp }) {
      let target = hash;

      for (let attempt = 1; ; attempt++) {
        current = new AbortController();
        const combined = AbortSignal.any([signal, current.signal]);
        try {
          return await gateway.waitForReceipt({
            hash: target,
            confirmations,
            signal: combined,
            onReplaced: (replacement) => {
              // A retry after a replacement must follow the new hash, not the dead one.
              target = replacement.hash;
              onReplaced(replacement);
            },
          });
        } catch (error) {
          if (signal.aborted || giveUp()) throw error;
          if (!isRetryableRead(classify(error)) || attempt >= maxAttempts) throw error;
          await sleep(delayMs(attempt), signal);
          // `abort()` during the sleep has nothing to abort, so re-check here.
          if (signal.aborted || giveUp()) throw error;
        } finally {
          current = null;
        }
      }
    },

    abort() {
      current?.abort();
    },
  };
}

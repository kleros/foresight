import { TransactionNotFoundError, TransactionReceiptNotFoundError } from "viem";
import type { Hash, PublicClient } from "viem";

import type { FlowTx, TxGateway, TxReplacement } from "./types";

export type ReceiptClient = Pick<
  PublicClient,
  "getTransactionReceipt" | "getTransaction" | "waitForTransactionReceipt"
>;

const aborted = () => new DOMException("Aborted", "AbortError");

/** Rejects as soon as the signal aborts, leaving the underlying promise to settle on its own. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(aborted());

  let onAbort!: () => void;
  const abortion = new Promise<never>((_, reject) => {
    onAbort = () => reject(aborted());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([promise, abortion]).finally(() => signal.removeEventListener("abort", onAbort));
}

/**
 * Binds the orchestrator to a viem public client
 */
export function createViemTxGateway(opts: {
  client: ReceiptClient;
  sendTransaction: (tx: FlowTx) => Promise<Hash>;
  /** Bounds how long an abandoned background poll survives. Default 10 minutes. */
  waitTimeoutMs?: number;
}): TxGateway {
  const { client, sendTransaction } = opts;
  const waitTimeoutMs = opts.waitTimeoutMs ?? 10 * 60 * 1000;

  return {
    // Before the call: as an argument it would prompt first and check after.
    sendTransaction: (tx, sendOpts) =>
      sendOpts?.signal?.aborted ? Promise.reject(aborted()) : abortable(sendTransaction(tx), sendOpts?.signal),

    waitForReceipt: ({ hash, confirmations, signal, onReplaced }) =>
      abortable(
        client.waitForTransactionReceipt({
          hash,
          confirmations,
          timeout: waitTimeoutMs,
          onReplaced: (replacement) => {
            const mapped: TxReplacement = { reason: replacement.reason, hash: replacement.transaction.hash };
            onReplaced?.(mapped);
          },
        }),
        signal,
      ),

    async getReceipt(hash) {
      try {
        return await client.getTransactionReceipt({ hash });
      } catch (error) {
        // viem throws rather than returning null for an unmined transaction.
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async isKnown(hash) {
      try {
        await client.getTransaction({ hash });
        return true;
      } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
      }
    },
  };
}

/**
 * viem signals "no such transaction (yet)" by throwing, where the port wants a
 * `null`.
 */
function isNotFound(error: unknown): boolean {
  if (error instanceof TransactionReceiptNotFoundError || error instanceof TransactionNotFoundError) return true;

  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  return name === "TransactionReceiptNotFoundError" || name === "TransactionNotFoundError";
}

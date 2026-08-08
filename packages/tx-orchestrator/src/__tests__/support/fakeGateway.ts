import { UserRejectedRequestError } from "viem";
import type { Hash, TransactionReceipt } from "viem";

import type { FlowTx, TxGateway, TxReplacement, TxReplacementReason } from "../../types";

/**
 * A wallet and a chain, scripted per step attempt.
 *
 * One entry per `sendTransaction`, that is, per *attempt*, so a step retried
 * after a rejection consumes the next entry and can behave differently.
 */
export type StepScript = {
  /** What the wallet does when prompted. Default: accepts. */
  sign?: "accept" | "reject" | "hold" | { throws: unknown };
  /** What the chain does with the broadcast transaction. Default: mines it. */
  mine?: "success" | "revert" | "hold" | { throws: unknown; attempts?: number };
  /** A replacement seen while waiting, the speed-up or cancel button. */
  replacedBy?: TxReplacementReason;
};

type Deferred = { promise: Promise<void>; release: () => void; fail: (error: unknown) => void };

function defer(): Deferred {
  let release!: () => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    release = () => resolve();
    fail = reject;
  });
  return { promise, release, fail };
}

function hashFor(n: number): Hash {
  return `0x${n.toString(16).padStart(64, "0")}` as Hash;
}

function receiptFor(hash: Hash, status: "success" | "reverted", blockNumber: bigint): TransactionReceipt {
  return {
    transactionHash: hash,
    status,
    blockNumber,
    /** Values below not consumed */
    blockHash: `0x${"b".repeat(64)}`,
    contractAddress: null,
    cumulativeGasUsed: 21_000n,
    effectiveGasPrice: 1_000_000_000n,
    from: "0x0000000000000000000000000000000000000009",
    gasUsed: 21_000n,
    logs: [],
    logsBloom: `0x${"0".repeat(512)}`,
    to: "0x0000000000000000000000000000000000000001",
    transactionIndex: 0,
    type: "eip1559",
  };
}

export type FakeGateway = TxGateway & {
  /** Transactions the wallet was asked to sign, in order. */
  readonly signRequests: FlowTx[];
  /** Hashes the orchestrator waited on, including repeats after a retry. */
  readonly waitedOn: Hash[];
  /** Release a held wallet prompt or a held mining wait. */
  releaseSign(): void;
  releaseMine(): void;
  /** Chain state used by reconciliation, independent of the step scripts. */
  setChainState(hash: Hash, state: { receipt?: "success" | "reverted" | null; known?: boolean }): void;
};

export function createFakeGateway(scripts: StepScript[] = []): FakeGateway {
  const signRequests: FlowTx[] = [];
  const waitedOn: Hash[] = [];
  const byHash = new Map<Hash, { script: StepScript; waitAttempts: number }>();
  const chain = new Map<Hash, { receipt: "success" | "reverted" | null; known: boolean }>();

  let attempt = 0;
  let heldSign: Deferred | null = null;
  let heldMine: Deferred | null = null;

  const scriptAt = (index: number): StepScript => scripts[index] ?? {};

  /** Rejects as soon as the caller's signal aborts, so waits are cancellable. */
  function abortable<T>(signal: AbortSignal | undefined, promise: Promise<T>): Promise<T> {
    if (!signal) return promise;
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }),
    ]);
  }

  return {
    signRequests,
    waitedOn,

    async sendTransaction(tx, opts) {
      const index = attempt++;
      const script = scriptAt(index);
      signRequests.push(tx);

      if (script.sign === "hold") {
        heldSign = defer();
        await abortable(opts?.signal, heldSign.promise);
      }
      if (script.sign === "reject") {
        throw new UserRejectedRequestError(new Error("MetaMask Tx Signature: User denied transaction signature."));
      }
      if (typeof script.sign === "object") throw script.sign.throws;

      const hash = hashFor(index + 1);
      byHash.set(hash, { script, waitAttempts: 0 });
      chain.set(hash, { receipt: null, known: true });
      return hash;
    },

    async waitForReceipt({ hash, signal, onReplaced }) {
      waitedOn.push(hash);
      // A replacement hash inherits the original's script.
      const entry = byHash.get(hash) ?? { script: {}, waitAttempts: 0 };
      entry.waitAttempts += 1;
      byHash.set(hash, entry);
      const { script } = entry;

      if (typeof script.mine === "object") {
        const attempts = script.mine.attempts ?? Infinity;
        if (entry.waitAttempts <= attempts) throw script.mine.throws;
      }

      if (script.mine === "hold") {
        heldMine = defer();
        await abortable(signal, heldMine.promise);
      }

      let settledHash = hash;
      if (script.replacedBy) {
        settledHash = hashFor(1000 + waitedOn.length);
        byHash.set(settledHash, { script: { ...script, replacedBy: undefined }, waitAttempts: 0 });
        const replacement: TxReplacement = { reason: script.replacedBy, hash: settledHash };
        onReplaced?.(replacement);
        chain.set(settledHash, { receipt: "success", known: true });
      }

      const status = script.mine === "revert" ? "reverted" : "success";
      chain.set(settledHash, { receipt: status, known: true });
      return receiptFor(settledHash, status, 19_000_000n);
    },

    async getReceipt(hash) {
      const state = chain.get(hash);
      if (!state || state.receipt === null) return null;
      return receiptFor(hash, state.receipt, 19_000_000n);
    },

    async isKnown(hash) {
      return chain.get(hash)?.known ?? false;
    },

    releaseSign() {
      heldSign?.release();
    },
    releaseMine() {
      heldMine?.release();
    },
    setChainState(hash, state) {
      const previous = chain.get(hash) ?? { receipt: null, known: false };
      chain.set(hash, {
        receipt: state.receipt === undefined ? previous.receipt : state.receipt,
        known: state.known ?? previous.known,
      });
    },
  };
}

export { hashFor };

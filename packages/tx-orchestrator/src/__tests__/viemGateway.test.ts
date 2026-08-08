import { createPublicClient, custom, type Hash } from "viem";
import { describe, expect, it, vi } from "vitest";

import { createViemTxGateway, type ReceiptClient } from "../viemGateway";

const HASH = "0x0000000000000000000000000000000000000000000000000000000000000001" as const;
const ADDRESS = "0x0000000000000000000000000000000000000009" as const;

const PENDING_TX = {
  hash: HASH,
  nonce: "0x0",
  blockHash: null,
  blockNumber: null,
  transactionIndex: null,
  from: ADDRESS,
  to: ADDRESS,
  value: "0x0",
  gas: "0x5208",
  gasPrice: "0x1",
  input: "0x",
  type: "0x0",
  v: "0x1b",
  r: `0x${"1".repeat(64)}`,
  s: `0x${"2".repeat(64)}`,
};

function realClient(handlers: Record<string, () => unknown>) {
  return createPublicClient({
    transport: custom(
      {
        request: async ({ method }) => {
          const handler = handlers[method];
          if (!handler) throw new Error(`unstubbed RPC call: ${method}`);
          return handler();
        },
      },
      { retryCount: 0 },
    ),
  });
}

function stubClient(overrides: Partial<ReceiptClient> = {}): ReceiptClient {
  return {
    getTransactionReceipt: vi.fn(),
    getTransaction: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
    ...overrides,
  } as ReceiptClient;
}

describe("createViemTxGateway, against a real viem client", () => {
  it("reads an unmined transaction as no receipt, not as a failure", async () => {
    const gateway = createViemTxGateway({
      client: realClient({ eth_getTransactionReceipt: () => null }),
      sendTransaction: vi.fn(),
    });

    await expect(gateway.getReceipt(HASH)).resolves.toBeNull();
  });

  it("lets a real RPC failure through rather than reporting an absent receipt", async () => {
    const gateway = createViemTxGateway({
      client: realClient({
        eth_getTransactionReceipt: () => {
          throw new Error("HTTP 500");
        },
      }),
      sendTransaction: vi.fn(),
    });

    await expect(gateway.getReceipt(HASH)).rejects.toThrow(/HTTP 500/);
  });

  it("reads an unknown transaction as dropped", async () => {
    const gateway = createViemTxGateway({
      client: realClient({ eth_getTransactionByHash: () => null }),
      sendTransaction: vi.fn(),
    });

    await expect(gateway.isKnown(HASH)).resolves.toBe(false);
  });

  it("reads a transaction the node still has as known", async () => {
    const gateway = createViemTxGateway({
      client: realClient({ eth_getTransactionByHash: () => PENDING_TX }),
      sendTransaction: vi.fn(),
    });

    await expect(gateway.isKnown(HASH)).resolves.toBe(true);
  });
});

describe("createViemTxGateway, on its own conventions", () => {
  it("passes a speed-up straight through as a replacement", async () => {
    const replacementHash = `0x${"f".repeat(64)}` as Hash;
    const gateway = createViemTxGateway({
      client: stubClient({
        waitForTransactionReceipt: vi.fn(async ({ onReplaced }) => {
          onReplaced?.({ reason: "repriced", transaction: { hash: replacementHash } } as never);
          return { transactionHash: replacementHash, status: "success" } as never;
        }),
      }),
      sendTransaction: vi.fn(),
    });
    const seen: unknown[] = [];

    await gateway.waitForReceipt({ hash: HASH, onReplaced: (r) => void seen.push(r) });

    expect(seen).toEqual([{ reason: "repriced", hash: replacementHash }]);
  });

  it("abandons a wait once the signal aborts, so pause is not held up by a slow block", async () => {
    const gateway = createViemTxGateway({
      client: stubClient({ waitForTransactionReceipt: () => new Promise<never>(() => {}) }),
      sendTransaction: vi.fn(),
    });
    const controller = new AbortController();

    const waiting = gateway.waitForReceipt({ hash: HASH, signal: controller.signal });
    controller.abort();

    await expect(waiting).rejects.toThrow(/abort/i);
  });
});

describe("createViemTxGateway, once the run is called off", () => {
  it("does not open a wallet for a signal that has already aborted", async () => {
    const sendTransaction = vi.fn(async () => "0x1" as Hash);
    const gateway = createViemTxGateway({ client: {} as ReceiptClient, sendTransaction });
    const controller = new AbortController();
    controller.abort();

    await expect(gateway.sendTransaction({ to: ADDRESS }, { signal: controller.signal })).rejects.toThrow();

    // Passing the prompt in as an argument would have opened it before the
    // check ever ran, and a signature after a trash is unrecoverable.
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("lets go of its abort listener once the call settles", async () => {
    const gateway = createViemTxGateway({ client: {} as ReceiptClient, sendTransaction: async () => "0x1" as Hash });
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, "addEventListener");
    const removed = vi.spyOn(controller.signal, "removeEventListener");

    for (let i = 0; i < 5; i++) {
      await gateway.sendTransaction({ to: ADDRESS }, { signal: controller.signal });
    }

    // The run-level signal outlives every step, so anything left attached here
    // accumulates for the life of the run.
    expect(removed).toHaveBeenCalledTimes(added.mock.calls.length);
  });
});

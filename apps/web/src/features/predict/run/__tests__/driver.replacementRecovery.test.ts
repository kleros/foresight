import {
  createFlowRunStore,
  createMemoryStorage,
  type FlowRunStore,
  type FlowTx,
  type TxGateway,
} from "@foresight/tx-orchestrator";
import { type Hash, type TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  chainState,
  ctx,
  fakeQuoter,
  fakeReader,
  gasLimitFor,
  option,
  snapshot,
  WAD,
} from "@/features/predict/flow/__tests__/support/fakes";
import type { PredictReader, PredictSnapshot } from "@/features/predict/flow/types";
import { createPredictRun } from "@/features/predict/run/driver";
import type { PredictDriver } from "@/features/predict/run/types";

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;
const receipt = (hash: Hash, status: "success" | "reverted" = "success") =>
  ({ transactionHash: hash, status, blockNumber: 20n, logs: [] }) as unknown as TransactionReceipt;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});
function run(args: {
  gateway: TxGateway;
  reader: PredictReader;
  store: FlowRunStore;
  flowId: string;
  request?: PredictSnapshot;
}) {
  const driver = createPredictRun({
    ...args,
    ctx: () => ctx(),
    quoter: fakeQuoter(),
    snapshot: () => args.request ?? snapshot({ options: [option(1), option(2)] }),
    unansweredSend: { waitMs: 0, pollMs: 1 },
  });
  drivers.push(driver);
  return driver;
}
describe("replacement recovery at durable-write boundaries", () => {
  it.each(["cancelled", "replaced"] as const)(
    "does not count a %s second batch as successful after reload",
    async (reason) => {
      const flowId = "replacement-reload";
      const store = createFlowRunStore({ storage: createMemoryStorage() });
      const sends: FlowTx[] = [];
      const replacementPersisted = deferred<void>();
      const cancelHash = hash(99);
      const gateway: TxGateway = {
        sendTransaction: async (tx) => {
          sends.push(tx);
          return hash(sends.length);
        },
        waitForReceipt: ({ hash: target, onReplaced }) => {
          if (target === hash(3)) {
            // A mined self-transfer at the batch's nonce. The receipt wait has announced
            // its replacement, but the original tab dies before settle() handles it.
            onReplaced?.({ reason, hash: cancelHash });
            replacementPersisted.resolve();
            return new Promise(() => {});
          }
          return Promise.resolve(receipt(target));
        },
        getReceipt: async (target) => receipt(target),
        isKnown: async () => true,
      };
      const reader = fakeReader({
        deployed: true,
        blockGasLimit: gasLimitFor(1),
        state: () => chainState({ underlying: WAD }),
      });
      const first = run({ gateway, reader, store, flowId });
      first.start();
      await replacementPersisted.promise;
      expect(store.load(flowId)?.steps.at(-1)?.outcome).toMatchObject({ status: "submitted", hash: cancelHash });
      first.dispose();

      const next = run({ gateway, reader, store, flowId });
      next.recover();
      await vi.waitFor(() => expect(next.getProgress().failure?.reason).toBe("cancelled"));
      expect(sends).toHaveLength(3);
      expect(next.getProgress().steps.at(-1)?.state).not.toBe("success");
      expect(store.load(flowId)).not.toBeNull();
    },
  );
});

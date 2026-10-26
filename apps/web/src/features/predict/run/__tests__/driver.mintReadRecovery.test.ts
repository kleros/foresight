import {
  createFlowRunStore,
  createMemoryStorage,
  type FlowRunStore,
  type FlowTx,
  type TxGateway,
} from "@foresight/tx-orchestrator";
import { decodeFunctionData, type Hash, type TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addresses,
  ctx,
  fakeQuoter,
  fakeReader,
  landedTx,
  option,
  snapshot,
  WAD,
} from "@/features/predict/flow/__tests__/support/fakes";
import { STEP_ID } from "@/features/predict/flow/plan";
import type { PredictCtx, PredictReader, PredictSnapshot } from "@/features/predict/flow/types";
import { createPredictRun } from "@/features/predict/run/driver";
import type { PredictDriver } from "@/features/predict/run/types";

import { gnosisRouterAbi, tradeExecutorAbi } from "@/config/contracts";

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
function parentSplit(tx: FlowTx): bigint {
  if (tx.to !== addresses.executor || !tx.data) return 0n;
  const batch = decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data });
  let sum = 0n;
  for (const call of batch.args[0] ?? []) {
    if (call.to !== addresses.router) continue;
    const inner = decodeFunctionData({ abi: gnosisRouterAbi, data: call.data });
    if (inner.functionName === "splitPosition" && inner.args[1] === addresses.parentMarket)
      sum += inner.args[2] as bigint;
  }
  return sum;
}

describe("native deposit mint recovery", () => {
  it("rereads the minted amount after reload during the deposit log read", async () => {
    const flowId = "mint-read-reload";
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const estimate = (WAD * 8n) / 10n;
    const minted = estimate - 1000n;
    const request = snapshot({ depositNative: true, collateralIn: estimate, collateralBefore: 0n });
    const prompt = deferred<void>();
    const mintReadStarted = deferred<void>();
    const mintRead = deferred<ReturnType<typeof landedTx>[]>();
    const sends: FlowTx[] = [];
    let deposit: FlowTx | undefined;
    let mined = false;
    let blockMintRead = true;
    const gateway: TxGateway = {
      sendTransaction: async (tx) => {
        sends.push(tx);
        if (tx.to === addresses.sDaiAdapter) {
          deposit = tx;
          prompt.resolve();
          return new Promise(() => {});
        }
        return hash(sends.length);
      },
      waitForReceipt: async ({ hash: target }) =>
        receipt(target, parentSplit(sends[Number(BigInt(target)) - 1]!) > minted ? "reverted" : "success"),
      getReceipt: async (target) => receipt(target),
      isKnown: async () => true,
    };
    const reader: PredictReader = {
      ...fakeReader({ deployed: true }),
      sentWithNonce: async () =>
        mined ? { status: "mined", hash: hash(1), success: true, ...landedTx(deposit!, minted) } : { status: "none" },
      landedSince: async () => {
        if (!mined) return [];
        if (blockMintRead) {
          mintReadStarted.resolve();
          return mintRead.promise;
        }
        return [landedTx(deposit!, minted)];
      },
    };
    const first = run({ gateway, reader, store, flowId, request });
    first.start();
    await prompt.promise;
    first.dispose();
    mined = true;

    const second = run({ gateway, reader, store, flowId, request });
    second.recover();
    await vi.waitFor(() => expect(second.getProgress().stage).toBe("review"));
    second.resume();
    await mintReadStarted.promise;
    const stored = store.load<PredictSnapshot, PredictCtx>(flowId)!;
    expect(stored.steps.find((s) => s.stepId === STEP_ID.deposit)?.outcome.status).toBe("skipped");
    expect(stored.snapshot.mintFinalized).not.toBe(true);
    expect(stored.snapshot.collateralIn).toBe(estimate);
    second.dispose(); // Reload while afterStep awaits the actual minted amount.
    blockMintRead = false;

    const third = run({ gateway, reader, store, flowId, request });
    third.recover();
    await vi.waitFor(() => expect(third.getProgress().stage).toBe("review"));
    third.resume();
    await vi.waitFor(() => expect(third.getProgress().stage).toBe("complete"));
    expect(parentSplit(sends.at(-1)!)).toBe(minted);
    expect(sends.filter((tx) => tx.to === addresses.sDaiAdapter)).toHaveLength(1);
    expect(store.load(flowId)).toBeNull();
  });
});

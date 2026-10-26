import { createFlowRunStore, createMemoryStorage, type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import { decodeFunctionData, type Hash, type TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { depositNativeTx } from "@/lib/trade-executor/funding";

import { gnosisRouterAbi, tradeExecutorAbi } from "@/config/contracts";

import { addresses, ctx, fakeQuoter, fakeReader, snapshot, WAD } from "../../flow/__tests__/support/fakes";
import type { LandedTx } from "../../flow/types";
import { createPredictRun } from "../driver";
import { predictFlowId } from "../interrupted";
import type { PredictDriver } from "../types";

const FLOW_ID = predictFlowId("session-1", addresses.owner);
const ESTIMATE = (WAD * 8n) / 10n;
const MINTED = ESTIMATE - 1_000n;

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

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

describe("createPredictRun with an xDAI deposit found landed", () => {
  it("splits what the deposit minted after the read of its mint failed once", async () => {
    const sends: FlowTx[] = [];
    let sent = 0;
    const receipt = (hash: Hash) =>
      ({ transactionHash: hash, status: "success", blockNumber: 2n, logs: [] }) as unknown as TransactionReceipt;
    const gateway: TxGateway = {
      sendTransaction: (tx) => {
        sends.push(tx);
        return Promise.resolve(`0x${(++sent).toString(16).padStart(64, "0")}` as Hash);
      },
      waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
      getReceipt: (hash) => Promise.resolve(receipt(hash)),
      isKnown: () => Promise.resolve(true),
    };
    const deposit = depositNativeTx({ executor: addresses.executor, sDaiAdapter: addresses.sDaiAdapter, amount: WAD });
    let calls = 0;
    let depositLanded = false;
    const reader = {
      ...fakeReader({ deployed: true }),
      landedSince: (): Promise<LandedTx[]> => {
        if (!depositLanded) return Promise.resolve([]);
        calls += 1;
        // the second read, the mint's after the skip, hits a rate limit
        if (calls === 2) return Promise.reject(new Error("HTTP request failed. Status: 429"));
        return Promise.resolve([
          { to: deposit.to, value: deposit.value ?? 0n, input: deposit.data ?? "0x", collateralReceived: MINTED },
        ]);
      },
    };
    const driver = createPredictRun({
      gateway,
      reader,
      quoter: fakeQuoter(),
      flowId: FLOW_ID,
      ctx: () => ctx(),
      snapshot: () => snapshot({ depositNative: true, deposit: WAD, collateralIn: ESTIMATE, collateralBefore: 0n }),
      store: createFlowRunStore({ storage: createMemoryStorage() }),
    });
    drivers.push(driver);
    // the deposit landed before the run reached it, as a reload of a run whose deposit mined finds it
    depositLanded = true;
    driver.start();
    await vi.waitFor(() => expect(["halted", "complete"]).toContain(driver.getProgress().stage));
    expect(driver.getProgress().failure?.reason).toBe("rpc");
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));
    const batch = sends.find((tx) => tx.to === addresses.executor);
    expect(batch && parentSplit(batch)).toBe(MINTED);
  });
});

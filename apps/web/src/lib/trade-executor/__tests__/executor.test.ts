import { decodeFunctionData, encodeFunctionResult, getAddress, zeroAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { tradeExecutorAbi, tradeExecutorFactoryAbi } from "@/config/contracts";

import { batchExecuteTx, batchValueExecuteTx, createExecutorTx, fetchExecutorState } from "../executor";
import { readClient } from "./support/readClient";

const FACTORY: Address = "0x00000000000000000000000000000000000000fa";
const OWNER: Address = "0x1111111111111111111111111111111111111111";

/** What the factory predicts for OWNER; the tests only care that it flows through. */
const PREDICTED: Address = "0x2222222222222222222222222222222222222222";

/** Answers the factory's two views: `executorOf` with whatever the test says is on chain. */
function factoryClient(executorOf: Address) {
  return readClient({
    call: ({ data }) => {
      const { functionName } = decodeFunctionData({ abi: tradeExecutorFactoryAbi, data });
      if (functionName === "predictExecutor") {
        return encodeFunctionResult({ abi: tradeExecutorFactoryAbi, functionName, result: PREDICTED });
      }
      if (functionName === "executorOf") {
        return encodeFunctionResult({ abi: tradeExecutorFactoryAbi, functionName, result: executorOf });
      }
      throw new Error(`unexpected factory read: ${functionName}`);
    },
  });
}

describe("fetchExecutorState", () => {
  it("reports the predicted address and no deployment while the executor has no code", async () => {
    const state = await fetchExecutorState(factoryClient(zeroAddress), { factory: FACTORY, owner: OWNER });

    expect(state).toEqual({ predicted: PREDICTED, deployed: null });
  });

  it("reports the executor as deployed once the factory sees code at it", async () => {
    const state = await fetchExecutorState(factoryClient(PREDICTED), { factory: FACTORY, owner: OWNER });

    expect(state).toEqual({ predicted: PREDICTED, deployed: PREDICTED });
  });
});

describe("createExecutorTx", () => {
  it("targets the factory with an argument-less createExecutor call", () => {
    const tx = createExecutorTx(FACTORY);

    expect(tx.to).toBe(FACTORY);
    expect(tx.value).toBeUndefined();
    expect(decodeFunctionData({ abi: tradeExecutorFactoryAbi, data: tx.data! }).functionName).toBe("createExecutor");
  });
});

// Checksummed, because decoded calldata comes back checksummed.
const EXECUTOR: Address = getAddress("0x00000000000000000000000000000000000000ee");
const TARGET: Address = getAddress("0x0000000000000000000000000000000000007a12");

describe("batchExecuteTx", () => {
  it("wraps the calls, in order, in one batchExecute on the executor", () => {
    const calls = [
      { to: TARGET, data: "0x01" as const },
      { to: TARGET, data: "0x02" as const },
    ];
    const tx = batchExecuteTx(EXECUTOR, calls);

    expect(tx.to).toBe(EXECUTOR);
    expect(tx.value).toBeUndefined();
    expect(decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data! })).toEqual({
      functionName: "batchExecute",
      args: [calls],
    });
  });
});

describe("batchValueExecuteTx", () => {
  it("wraps the calls with their value in one batchValueExecute on the executor", () => {
    const calls = [{ to: TARGET, value: 7n, data: "0x" as const }];
    const tx = batchValueExecuteTx(EXECUTOR, calls);

    expect(tx.to).toBe(EXECUTOR);
    // the executor pays each leg from its own balance; the transaction itself carries nothing
    expect(tx.value).toBeUndefined();
    expect(decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data! })).toEqual({
      functionName: "batchValueExecute",
      args: [calls],
    });
  });
});

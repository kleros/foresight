import { tradeExecutorCreationCode } from "@foresight/contracts";
import gnosisFactory from "@foresight/contracts/deployments/gnosis/TradeExecutorFactory.json";
import { decodeFunctionData, encodeFunctionResult, getAddress, zeroAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { tradeExecutorAbi, tradeExecutorFactoryAbi } from "@/config/contracts";

import {
  batchExecuteTx,
  batchValueExecuteTx,
  createExecutorTx,
  executorAddress,
  fetchExecutorState,
  TradeWalletMismatchError,
} from "../executor";
import { readClient } from "./support/readClient";

const FACTORY: Address = "0x00000000000000000000000000000000000000fa";
const OWNER: Address = "0x1111111111111111111111111111111111111111";
const ATTACKER: Address = "0x9999999999999999999999999999999999999999";

/** The trade wallet the factory deploys for OWNER. */
const PREDICTED = executorAddress(FACTORY, OWNER);

/** Answers the factory's two views: `predictExecutor` with `predicted`, `executorOf` with what is on chain. */
function factoryClient(executorOf: Address, predicted: Address = PREDICTED) {
  return readClient({
    call: ({ data }) => {
      const { functionName } = decodeFunctionData({ abi: tradeExecutorFactoryAbi, data });
      if (functionName === "predictExecutor") {
        return encodeFunctionResult({ abi: tradeExecutorFactoryAbi, functionName, result: predicted });
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

  it.each([
    ["a predicted trade wallet", zeroAddress, ATTACKER],
    ["a deployed trade wallet", ATTACKER, PREDICTED],
  ] as const)("refuses %s the node names other than the factory's own derivation", async (_, executorOf, predicted) => {
    await expect(
      fetchExecutorState(factoryClient(executorOf, predicted), { factory: FACTORY, owner: OWNER }),
    ).rejects.toThrow(new TradeWalletMismatchError());
  });

  it("tells the visitor to change RPC when the node names another trade wallet", () => {
    expect(new TradeWalletMismatchError().message).toBe(
      "Your network named a different trade wallet. Switch to another RPC and try again.",
    );
  });
});

describe("executorAddress", () => {
  it("gives the address the gnosis factory answers for an owner", () => {
    // as TradeExecutorFactory at this address answers predictExecutor on a gnosis fork
    expect(executorAddress(gnosisFactory.address as Address, "0x00000000000000000000000000000000000000a1")).toBe(
      "0xff8F719427c050fFF02f6AAd8dd28D2d44e9935E",
    );
    expect(executorAddress(gnosisFactory.address as Address, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")).toBe(
      "0xdCEe80927E54E243c5af17f9825ce55909D3664F",
    );
  });

  it("derives from the creation code the deployed gnosis factory carries", () => {
    expect(gnosisFactory.bytecode).toContain(tradeExecutorCreationCode.slice(2));
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

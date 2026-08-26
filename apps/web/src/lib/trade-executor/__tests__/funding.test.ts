import { decodeFunctionData, erc20Abi, getAddress, parseEther, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { tradeExecutorAbi } from "@/config/contracts";

import { depositTx, withdrawTx } from "../funding";

// Checksummed, because decoded calldata comes back checksummed.
const EXECUTOR: Address = getAddress("0x00000000000000000000000000000000000000ee");
const OWNER: Address = "0x1111111111111111111111111111111111111111";
const TOKEN: Address = "0x3333333333333333333333333333333333333333";

const AMOUNT = parseEther("25");

describe("depositTx", () => {
  it("moves native value straight to the executor", () => {
    const tx = depositTx({ executor: EXECUTOR, asset: { token: "native", amount: AMOUNT } });

    expect(tx).toEqual({ to: EXECUTOR, value: AMOUNT });
  });

  it("moves a token by asking it to transfer to the executor", () => {
    const tx = depositTx({ executor: EXECUTOR, asset: { token: TOKEN, amount: AMOUNT } });

    expect(tx.to).toBe(TOKEN);
    expect(tx.value).toBeUndefined();
    expect(decodeFunctionData({ abi: erc20Abi, data: tx.data! })).toEqual({
      functionName: "transfer",
      args: [EXECUTOR, AMOUNT],
    });
  });
});

describe("withdrawTx", () => {
  it("batches native and token legs through the executor to the recipient", () => {
    const tx = withdrawTx({
      executor: EXECUTOR,
      recipient: OWNER,
      assets: [
        { token: "native", amount: AMOUNT },
        { token: TOKEN, amount: AMOUNT * 2n },
      ],
    });

    expect(tx.to).toBe(EXECUTOR);
    // The executor pays the legs from its own balance; the transaction itself carries nothing.
    expect(tx.value).toBeUndefined();

    const decoded = decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data! });
    if (decoded.functionName !== "batchValueExecute") throw new Error(`decoded as ${decoded.functionName}`);

    const [calls] = decoded.args;
    expect(calls).toHaveLength(2);
    const [nativeLeg, tokenLeg] = calls;

    // Empty calldata is what lets the executor pay an externally-owned recipient.
    expect(nativeLeg).toEqual({ to: OWNER, value: AMOUNT, data: "0x" });

    expect(tokenLeg?.to).toBe(TOKEN);
    expect(tokenLeg?.value).toBe(0n);
    expect(decodeFunctionData({ abi: erc20Abi, data: tokenLeg!.data })).toEqual({
      functionName: "transfer",
      args: [OWNER, AMOUNT * 2n],
    });
  });

  it("refuses a withdraw with nothing in it", () => {
    expect(() => withdrawTx({ executor: EXECUTOR, recipient: OWNER, assets: [] })).toThrow();
  });
});

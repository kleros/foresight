import { decodeFunctionData, erc20Abi, getAddress, parseEther, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { gnosisRouterAbi, tradeExecutorAbi } from "@/config/contracts";

import { mergeTx, splitTx } from "../positions";

// Checksummed, because decoded calldata comes back checksummed.
const EXECUTOR: Address = getAddress("0x00000000000000000000000000000000000000ee");
const ROUTER: Address = getAddress("0x0000000000000000000000000000000000004004");
const COLLATERAL: Address = getAddress("0x000000000000000000000000000000000000ada1");
const PARENT_MARKET: Address = getAddress("0x0000000000000000000000000000000000000ace");
const OUTCOMES: Address[] = [
  getAddress("0x00000000000000000000000000000000000000a1"),
  getAddress("0x00000000000000000000000000000000000000a2"),
];
const INVALID: Address = getAddress("0x00000000000000000000000000000000000000a0");

const AMOUNT = parseEther("25");

const base = { executor: EXECUTOR, router: ROUTER, collateral: COLLATERAL, parentMarket: PARENT_MARKET };

/** The executor's own call carries the batch; every assertion here is about what is inside it. */
function batchedCalls(data: Hex) {
  const decoded = decodeFunctionData({ abi: tradeExecutorAbi, data });
  if (decoded.functionName !== "batchExecute") throw new Error(`decoded as ${decoded.functionName}`);

  return decoded.args[0];
}

const approvedSpender = (call: { to: Address; data: Hex }) => {
  const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data });
  if (decoded.functionName !== "approve") throw new Error(`decoded as ${decoded.functionName}`);

  return { token: call.to, spender: decoded.args[0], amount: decoded.args[1] };
};

describe("splitTx", () => {
  it("approves the collateral and splits it, in that order", () => {
    const tx = splitTx({ ...base, amount: AMOUNT });

    expect(tx.to).toBe(EXECUTOR);
    const calls = batchedCalls(tx.data!);
    expect(calls).toHaveLength(2);

    expect(approvedSpender(calls[0]!)).toEqual({ token: COLLATERAL, spender: ROUTER, amount: AMOUNT });

    expect(calls[1]?.to).toBe(ROUTER);
    expect(decodeFunctionData({ abi: gnosisRouterAbi, data: calls[1]!.data })).toEqual({
      functionName: "splitPosition",
      args: [COLLATERAL, PARENT_MARKET, AMOUNT],
    });
  });
});

describe("mergeTx", () => {
  it("approves every outcome token, INVALID included, before merging", () => {
    const tx = mergeTx({ ...base, outcomeTokens: OUTCOMES, invalidToken: INVALID, amount: AMOUNT });

    expect(tx.to).toBe(EXECUTOR);
    const calls = batchedCalls(tx.data!);
    // one approval per outcome, one for INVALID, then the merge
    expect(calls).toHaveLength(4);

    const approvals = calls.slice(0, 3).map((call) => approvedSpender(call));
    expect(approvals.map((approval) => approval.token)).toEqual([...OUTCOMES, INVALID]);
    for (const approval of approvals) {
      expect([approval.spender, approval.amount]).toEqual([ROUTER, AMOUNT]);
    }

    expect(calls[3]?.to).toBe(ROUTER);
    expect(decodeFunctionData({ abi: gnosisRouterAbi, data: calls[3]!.data })).toEqual({
      functionName: "mergePositions",
      args: [COLLATERAL, PARENT_MARKET, AMOUNT],
    });
  });

  it("refuses a merge with no outcome tokens, which would burn INVALID alone", () => {
    expect(() => mergeTx({ ...base, outcomeTokens: [], invalidToken: INVALID, amount: AMOUNT })).toThrow();
  });
});

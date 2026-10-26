import type { FlowTx } from "@foresight/tx-orchestrator";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { ALGEBRA_ROUTER_ABI } from "@/lib/swap/algebraRouter";

import { tradeExecutorAbi } from "@/config/contracts";

import { assertListed, departures, UnlistedTxError } from "../allowed";
import { addresses, ctx } from "./support/fakes";

const other: Address = "0x00000000000000000000000000000000000000ee";
const transfer = (to: Address) =>
  encodeFunctionData({
    abi: parseAbi(["function transfer(address,uint256)"]),
    functionName: "transfer",
    args: [to, 7n],
  });
const approve = (spender: Address, amount = 7n) =>
  encodeFunctionData({
    abi: parseAbi(["function approve(address,uint256)"]),
    functionName: "approve",
    args: [spender, amount],
  });
const swap = (recipient = addresses.executor, limitSqrtPrice = 1n) =>
  encodeFunctionData({
    abi: ALGEBRA_ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: addresses.collateral,
        tokenOut: addresses.wxdai,
        recipient,
        deadline: 1800n,
        amountIn: 7n,
        amountOutMinimum: 3n,
        limitSqrtPrice,
      },
    ],
  });
const batch = (to: Address, data: Hex): FlowTx => ({
  to: addresses.executor,
  data: encodeFunctionData({ abi: tradeExecutorAbi, functionName: "batchExecute", args: [[{ to, data }]] }),
});
const execute = (to: Address, outputToken: Address, recipient = addresses.executor) =>
  batch(
    addresses.manager,
    encodeFunctionData({
      abi: parseAbi(["function execute(address,bytes,uint256,address)"]),
      functionName: "execute",
      args: [to, swap(recipient), 7n, outputToken],
    }),
  );
const check = (tx: FlowTx) => assertListed({ tx, ctx: ctx(), sessionTokens: [addresses.collateral] });

describe("predict transaction allow-list", () => {
  it("accepts a finite router approval without an optional sender", () => {
    expect(() => check(batch(addresses.collateral, approve(addresses.swapRouter)))).not.toThrow();
  });

  it("refuses a chain without an allow-list", () => {
    expect(
      departures({
        tx: { to: addresses.collateral, data: transfer(addresses.executor) },
        ctx: ctx({ chainId: 999999 }),
        sessionTokens: [],
      }),
    ).toEqual(["no allow-list for chain 999999"]);
  });

  it.each([
    ["selector on another target", { to: other, data: transfer(addresses.executor) }],
    ["unlisted selector on collateral", { to: addresses.collateral, data: approve(addresses.swapRouter) }],
    [
      "native deposit to another receiver",
      {
        to: addresses.sDaiAdapter,
        value: 7n,
        data: encodeFunctionData({
          abi: parseAbi(["function depositXDAI(address) payable"]),
          functionName: "depositXDAI",
          args: [other],
        }),
      },
    ],
    ["native value on a transfer", { to: addresses.collateral, value: 1n, data: transfer(addresses.executor) }],
    ["transfer to another receiver", { to: addresses.collateral, data: transfer(other) }],
    ["approval to another spender", batch(addresses.collateral, approve(other))],
    ["unlimited router approval", batch(addresses.collateral, approve(addresses.swapRouter, 2n ** 256n - 1n))],
    ["swap to another receiver", batch(addresses.swapRouter, swap(other))],
    ["swap without a price limit", batch(addresses.swapRouter, swap(addresses.executor, 0n))],
    ["credits through another router", execute(other, addresses.wxdai)],
    ["credits buying another token", execute(addresses.swapRouter, other)],
    ["credits to another receiver", execute(addresses.swapRouter, addresses.wxdai, other)],
    [
      "native split for another parent",
      {
        to: addresses.executor,
        data: encodeFunctionData({
          abi: tradeExecutorAbi,
          functionName: "batchValueExecute",
          args: [
            [
              {
                to: addresses.wxdai,
                value: 0n,
                data: encodeFunctionData({
                  abi: parseAbi(["function withdraw(uint256)"]),
                  functionName: "withdraw",
                  args: [7n],
                }),
              },
              {
                to: addresses.router,
                value: 7n,
                data: encodeFunctionData({
                  abi: parseAbi(["function splitFromBase(address) payable"]),
                  functionName: "splitFromBase",
                  args: [other],
                }),
              },
            ],
          ],
        }),
      },
    ],
  ] satisfies [string, FlowTx][])("refuses %s", (_, tx) => {
    expect(() => check(tx)).toThrow(UnlistedTxError);
  });
});

it("accepts a native deposit paying this executor", () => {
  const tx = {
    to: addresses.sDaiAdapter,
    value: 7n,
    data: encodeFunctionData({
      abi: parseAbi(["function depositXDAI(address) payable"]),
      functionName: "depositXDAI",
      args: [addresses.executor],
    }),
  };
  expect(() => check(tx)).not.toThrow();
});
it("refuses a send from anyone other than the run owner", () => {
  expect(() =>
    assertListed({
      tx: { to: addresses.collateral, data: transfer(addresses.executor) },
      ctx: ctx(),
      sessionTokens: [addresses.collateral],
      from: other,
    }),
  ).toThrow(UnlistedTxError);
});

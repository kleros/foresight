import { decodeFunctionData, getAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { gnosisRouterAbi, tradeExecutorAbi } from "@/config/contracts";

import type { SessionResolution } from "../../api/getSessionResolution";
import { planTradeWalletRedeem, type TradeWalletRedeemInput } from "../plan";

const at = (prefix: string): Address => getAddress(`0x${prefix.padEnd(40, "0")}`);
const PARENT = at("b0");
const CHILD = at("c1");
const parentTokens = [at("e00"), at("e01"), at("e02")];
const childTokens = [at("d00"), at("d01"), at("d02")];

/** Both options pay a third and INVALID pays a third; child 0 resolved at 1 of 100. */
const resolution: SessionResolution = {
  parent: {
    resolved: true,
    invalid: true,
    winningOutcomes: [0, 1],
    payoutNumerators: [1n, 1n, 1n],
    payoutDenominator: 3n,
  },
  children: {
    0: {
      deployed: true,
      market: CHILD,
      resolved: true,
      invalid: false,
      finalValue: 1,
      payoutNumerators: [99n, 1n, 0n],
      payoutDenominator: 100n,
    },
  },
};

const input = (parent: bigint[], child: bigint[]): TradeWalletRedeemInput => ({
  chainId: 100,
  owner: at("1a01"),
  collateral: at("af"),
  parentMarket: PARENT,
  resolution,
  parentTokens: parentTokens.map((token, index) => ({ token, balance: parent[index]! })),
  childTokens: { 0: childTokens.map((token, slot) => ({ token, balance: child[slot]! })) },
});

const calls = (data: `0x${string}`) =>
  decodeFunctionData({ abi: tradeExecutorAbi, data }).args[0] as readonly { to: Address; data: `0x${string}` }[];

describe("a token or part that pays less than 1 wei after flooring", () => {
  it("gives a parent token whose floored payout is 0 no index and no approve", () => {
    // 2 wei at 1/3 floors to 0; 3 wei at 1/3 pays 1
    const plan = planTradeWalletRedeem(input([2n, 3n, 0n], [0n, 0n, 0n]));
    const batch = calls(plan.tx!.data!);

    expect(batch.map(({ to }) => to)).not.toContain(parentTokens[0]);
    const redeem = decodeFunctionData({ abi: gnosisRouterAbi, data: batch.at(-1)!.data });
    expect(redeem.args[2]).toEqual([1n]);
    expect(plan.parts).toEqual([{ market: PARENT, payout: 1n }]);
  });

  it("gives a child part no call and no row when its parent outcome tokens floor to 0 sDAI", () => {
    // UP 100 at 1/100 → 1 parent outcome token, at 1/3 → 0
    const plan = planTradeWalletRedeem(input([0n, 0n, 0n], [0n, 100n, 0n]));

    expect(plan.parts).toEqual([]);
    expect(plan.tx).toBeNull();
  });

  it("redeems the child part once it pays 1 wei, leaving out its UP token that floors to 0", () => {
    // DOWN 4 at 99/100 → 3, UP 50 at 1/100 → 0; 3 parent outcome tokens at 1/3 → 1
    const plan = planTradeWalletRedeem(input([0n, 0n, 0n], [4n, 50n, 0n]));
    const batch = calls(plan.tx!.data!);

    expect(plan.parts).toEqual([{ market: CHILD, payout: 1n }]);
    expect(batch.map(({ to }) => to)).not.toContain(childTokens[1]);
    expect(batch.map(({ to }) => to)).toContain(childTokens[0]);
  });
});

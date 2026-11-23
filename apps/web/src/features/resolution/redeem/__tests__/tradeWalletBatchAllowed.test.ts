import { decodeFunctionData, encodeFunctionData, erc20Abi, getAddress, maxUint256, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { batchExecuteTx, executorAddress, type ExecutorCall } from "@/lib/trade-executor/executor";
import { approveCall } from "@/lib/trade-executor/positions";

import { gnosisRouterAbi, tradeExecutorAbi, tradeExecutorFactoryAddress } from "@/config/contracts";

import { REDEEM_ALLOW_LIST } from "../../oracle/allowlist";
import { conditionalRouterAbi, planTradeWalletRedeem, type TradeWalletRedeemInput } from "../plan";
import {
  assertTradeWalletBatchAllowed,
  tradeWalletBatchDepartures,
  UnlistedRedeemBatchError,
  type RedeemScope,
} from "../tradeWalletBatchAllowed";

const CHAIN_ID = 100;
const LIST = REDEEM_ALLOW_LIST[CHAIN_ID]!;
const WAD = 10n ** 18n;
const at = (prefix: string): Address => getAddress(`0x${prefix.padEnd(40, "0")}`);

const SDAI = at("af");
const PARENT = at("b0");
const OWNER = at("1a01");
const OTHER = at("1a02");
const STRANGER = at("5a");
const CHILD = [at("c1"), at("c2")];
const parentTokens = [at("e00"), at("e01"), at("e02")];
const childTokens = CHILD.map((_, option) => [0, 1, 2].map((slot) => at(`d${option}${slot}`)));

const scope: RedeemScope = {
  collateral: SDAI,
  parentMarket: PARENT,
  parentTokens,
  children: { 0: { market: CHILD[0]!, tokens: childTokens[0]! }, 1: { market: CHILD[1]!, tokens: childTokens[1]! } },
};

/** Option 0 won and its child resolved at 40; option 1 lost. */
const input: TradeWalletRedeemInput = {
  chainId: CHAIN_ID,
  owner: OWNER,
  collateral: SDAI,
  parentMarket: PARENT,
  resolution: {
    parent: {
      resolved: true,
      invalid: false,
      winningOutcomes: [0],
      payoutNumerators: [1n, 0n, 0n],
      payoutDenominator: 1n,
    },
    children: {
      0: {
        deployed: true,
        market: CHILD[0]!,
        resolved: true,
        invalid: false,
        finalValue: 40,
        payoutNumerators: [60n, 40n, 0n],
        payoutDenominator: 100n,
      },
    },
  },
  parentTokens: parentTokens.map((token) => ({ token, balance: 3n * WAD })),
  childTokens: { 0: childTokens[0]!.map((token) => ({ token, balance: 2n * WAD })) },
};

const plan = planTradeWalletRedeem(input);
const tradeWallet = executorAddress(tradeExecutorFactoryAddress(CHAIN_ID)!, OWNER);
const plannedCalls = (): ExecutorCall[] => [
  ...(decodeFunctionData({ abi: tradeExecutorAbi, data: plan.tx!.data! }).args[0] as readonly ExecutorCall[]),
];

const departures = (calls: ExecutorCall[], account: Address | undefined = OWNER, to: Address = tradeWallet) =>
  tradeWalletBatchDepartures({ tx: batchExecuteTx(to, calls), chainId: CHAIN_ID, account, scope });

const parentRedeem = (collateral: Address, market: Address, indexes: bigint[], amounts: bigint[]): ExecutorCall => ({
  to: LIST.gnosisRouter,
  data: encodeFunctionData({
    abi: gnosisRouterAbi,
    functionName: "redeemPositions",
    args: [collateral, market, indexes, amounts],
  }),
});

const childRedeem = (
  collateral: Address,
  market: Address,
  indexes: bigint[],
  parentIndexes: bigint[],
  amounts: bigint[],
): ExecutorCall => ({
  to: LIST.conditionalRouter,
  data: encodeFunctionData({
    abi: conditionalRouterAbi,
    functionName: "redeemConditionalToCollateral",
    args: [collateral, market, indexes, parentIndexes, amounts],
  }),
});

const transfer = (token: Address): ExecutorCall => ({
  to: token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [STRANGER, 1n] }),
});

describe("a trade wallet redeem batch against the allow-list (oracle R8)", () => {
  it("lets the planner's own batch through, for the account it was planned for", () => {
    expect(plannedCalls().length).toBe(5);
    expect(departures(plannedCalls())).toEqual([]);
    expect(() =>
      assertTradeWalletBatchAllowed({ tx: plan.tx!, chainId: CHAIN_ID, account: OWNER, scope }),
    ).not.toThrow();
  });

  const tampered: { case: string; calls: () => ExecutorCall[]; account?: Address; to?: Address }[] = [
    { case: "another owner's account sends it", calls: plannedCalls, account: OTHER },
    { case: "it goes to another owner's trade wallet", calls: plannedCalls, to: executorAddress(at("fac"), OWNER) },
    { case: "a transfer is appended", calls: () => [...plannedCalls(), transfer(parentTokens[0]!)] },
    { case: "a transfer replaces an approve", calls: () => [transfer(parentTokens[0]!), ...plannedCalls().slice(1)] },
    {
      case: "an approve is one wei above its redeem",
      calls: () => [approveCall(parentTokens[0]!, LIST.gnosisRouter, 3n * WAD + 1n), ...plannedCalls().slice(1)],
    },
    {
      case: "an approve is unbounded",
      calls: () => [approveCall(parentTokens[0]!, LIST.gnosisRouter, maxUint256), ...plannedCalls().slice(1)],
    },
    {
      case: "an approve names another spender",
      calls: () => [approveCall(parentTokens[0]!, STRANGER, 3n * WAD), ...plannedCalls().slice(1)],
    },
    {
      case: "an approve names the other router",
      calls: () => [approveCall(parentTokens[0]!, LIST.conditionalRouter, 3n * WAD), ...plannedCalls().slice(1)],
    },
    {
      case: "the parent redeem names another collateral",
      calls: () => [plannedCalls()[0]!, parentRedeem(STRANGER, PARENT, [0n], [3n * WAD]), ...plannedCalls().slice(2)],
    },
    {
      case: "the parent redeem names another market",
      calls: () => [plannedCalls()[0]!, parentRedeem(SDAI, STRANGER, [0n], [3n * WAD]), ...plannedCalls().slice(2)],
    },
    {
      case: "the parent redeem pulls an index twice",
      calls: () => [
        plannedCalls()[0]!,
        approveCall(parentTokens[0]!, LIST.gnosisRouter, 3n * WAD),
        parentRedeem(SDAI, PARENT, [0n, 0n], [3n * WAD, 3n * WAD]),
        ...plannedCalls().slice(2),
      ],
    },
    {
      case: "the child redeem names another collateral",
      calls: () => [
        ...plannedCalls().slice(0, 4),
        childRedeem(STRANGER, CHILD[0]!, [1n, 0n], [0n], [2n * WAD, 2n * WAD]),
      ],
    },
    {
      case: "the child redeem names another session's market",
      calls: () => [...plannedCalls().slice(0, 4), childRedeem(SDAI, STRANGER, [1n, 0n], [0n], [2n * WAD, 2n * WAD])],
    },
    {
      case: "the child redeem names another parent outcome",
      calls: () => [...plannedCalls().slice(0, 4), childRedeem(SDAI, CHILD[0]!, [1n, 0n], [1n], [2n * WAD, 2n * WAD])],
    },
    {
      case: "the child redeem orders DOWN before UP",
      calls: () => [
        ...plannedCalls().slice(0, 2),
        plannedCalls()[3]!,
        plannedCalls()[2]!,
        childRedeem(SDAI, CHILD[0]!, [0n, 1n], [0n], [2n * WAD, 2n * WAD]),
      ],
    },
    {
      case: "the redeem comes before its approve",
      calls: () => [plannedCalls()[1]!, plannedCalls()[0]!, ...plannedCalls().slice(2)],
    },
    { case: "an approve is left with no redeem", calls: () => plannedCalls().slice(0, 4) },
    {
      case: "an approve is for a later redeem than the next one",
      calls: () => [plannedCalls()[0]!, plannedCalls()[2]!, plannedCalls()[1]!, ...plannedCalls().slice(3)],
    },
    { case: "the batch is empty", calls: () => [] },
  ];

  it.each(tampered)("stops it when $case", ({ calls, account, to }) => {
    const found = departures(calls(), account, to);

    expect(found.length).toBeGreaterThan(0);
    expect(() =>
      assertTradeWalletBatchAllowed({
        tx: batchExecuteTx(to ?? tradeWallet, calls()),
        chainId: CHAIN_ID,
        account: account ?? OWNER,
        scope,
      }),
    ).toThrow(UnlistedRedeemBatchError);
  });

  it("names an unbounded approve even when its redeem pulls that same amount", () => {
    const calls = [
      approveCall(parentTokens[0]!, LIST.gnosisRouter, maxUint256),
      parentRedeem(SDAI, PARENT, [0n], [maxUint256]),
    ];
    expect(departures(calls)).toEqual(["call 0: approves an unbounded amount"]);
  });

  it("names an approve to a spender outside the allow-list", () => {
    const calls = [approveCall(parentTokens[0]!, STRANGER, 3n * WAD), ...plannedCalls().slice(1)];
    expect(departures(calls)).toContain(`call 0: approves ${STRANGER}`);
  });

  it.each([
    {
      router: "Seer router",
      calls: [
        approveCall(parentTokens[0]!, LIST.gnosisRouter, 3n * WAD),
        parentRedeem(SDAI, PARENT, [0n], [3n * WAD, 3n * WAD]),
      ],
    },
    {
      router: "conditional router",
      calls: [
        approveCall(childTokens[0]![1]!, LIST.conditionalRouter, 2n * WAD),
        childRedeem(SDAI, CHILD[0]!, [1n], [0n], [2n * WAD, 2n * WAD]),
      ],
    },
  ])("names a $router redeem that carries more amounts than indexes", ({ calls }) => {
    expect(departures(calls)).toEqual(["call 1: indexes and amounts differ in length"]);
  });

  it("stops a transaction that carries native value, or is not a batchExecute", () => {
    const tx = plan.tx!;
    expect(
      tradeWalletBatchDepartures({ tx: { ...tx, value: 1n }, chainId: CHAIN_ID, account: OWNER, scope }),
    ).not.toEqual([]);
    const execute: Hex = encodeFunctionData({
      abi: tradeExecutorAbi,
      functionName: "batchValueExecute",
      args: [[{ to: STRANGER, data: "0x", value: 1n }]],
    });
    expect(
      tradeWalletBatchDepartures({ tx: { to: tx.to, data: execute }, chainId: CHAIN_ID, account: OWNER, scope }),
    ).not.toEqual([]);
  });

  it("stops everything with no connected account or on a chain with no allow-list", () => {
    expect(tradeWalletBatchDepartures({ tx: plan.tx!, chainId: CHAIN_ID, account: undefined, scope })).toEqual([
      "no connected account",
    ]);
    expect(tradeWalletBatchDepartures({ tx: plan.tx!, chainId: 31337, account: OWNER, scope })).toEqual([
      "no allow-list for chain 31337",
    ]);
  });
});

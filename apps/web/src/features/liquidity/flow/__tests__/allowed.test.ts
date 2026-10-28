import type { FlowTx } from "@foresight/tx-orchestrator";
import {
  encodeFunctionData,
  isAddressEqual,
  parseAbi,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { describe, expect, it } from "vitest";

import { ALGEBRA_ROUTER_ABI } from "@/lib/swap/algebraRouter";

import { gnosisRouterAbi } from "@/config/contracts";

import { NEW_POOL_TICK_SPACING } from "../../oracle/tolerances";
import { assertListed, departures, UnlistedTxError } from "../allowed";
import { planMerge, planRemove, planSeed } from "../plan";
import {
  APPROVE_ABI,
  CHAIN_TIME,
  LIST,
  MAX_UINT128,
  NFPM_ABI,
  branch,
  fullRange,
  missing,
  owner,
  sDai,
  session,
  sortPair,
  stranger,
  txsOf,
  userSqrtPrice,
  type PoolStateInput,
} from "./support/session";

const same = (a: Address, b: Address) => isAddressEqual(a, b);
const s = session([branch(1), branch(2)]);
const [b1, b2] = s.branches as [(typeof s.branches)[0], (typeof s.branches)[0]];
const { tickLower, tickUpper } = fullRange(NEW_POOL_TICK_SPACING);
const upPair = sortPair(b1.upToken, b1.outcome);
const downPair = sortPair(b1.downToken, b1.outcome);

const approve = (token: Address, spender: Address = LIST.positionManager, amount = 7n, value?: bigint): FlowTx => ({
  to: token,
  data: encodeFunctionData({ abi: APPROVE_ABI, functionName: "approve", args: [spender, amount] }),
  ...(value === undefined ? {} : { value }),
});
const router = (
  functionName: "splitPosition" | "mergePositions",
  collateral: Address,
  market: Address,
  value?: bigint,
): FlowTx => ({
  to: LIST.gnosisRouter,
  data: encodeFunctionData({ abi: gnosisRouterAbi, functionName, args: [collateral, market, 7n] }),
  ...(value === undefined ? {} : { value }),
});
const splitFromBase = (market: Address): FlowTx => ({
  to: LIST.gnosisRouter,
  value: 7n,
  data: encodeFunctionData({ abi: gnosisRouterAbi, functionName: "splitFromBase", args: [market] }),
});
const create = ([token0, token1]: [Address, Address]): Hex =>
  encodeFunctionData({
    abi: NFPM_ABI,
    functionName: "createAndInitializePoolIfNecessary",
    args: [token0, token1, 2n ** 96n],
  });
const mint = ([token0, token1]: [Address, Address], recipient: Address = owner): Hex =>
  encodeFunctionData({
    abi: NFPM_ABI,
    functionName: "mint",
    args: [
      {
        token0,
        token1,
        tickLower,
        tickUpper,
        amount0Desired: 7n,
        amount1Desired: 7n,
        amount0Min: 1n,
        amount1Min: 1n,
        recipient,
        deadline: CHAIN_TIME,
      },
    ],
  });
const decrease = encodeFunctionData({
  abi: NFPM_ABI,
  functionName: "decreaseLiquidity",
  args: [{ tokenId: 1n, liquidity: 7n, amount0Min: 1n, amount1Min: 1n, deadline: CHAIN_TIME }],
});
const collect = (recipient: Address = owner) =>
  encodeFunctionData({
    abi: NFPM_ABI,
    functionName: "collect",
    args: [{ tokenId: 1n, recipient, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
  });
const burn = encodeFunctionData({ abi: NFPM_ABI, functionName: "burn", args: [1n] });
const multicall = (inner: Hex[], value?: bigint): FlowTx => ({
  to: LIST.positionManager,
  data: encodeFunctionData({ abi: NFPM_ABI, functionName: "multicall", args: [inner] }),
  ...(value === undefined ? {} : { value }),
});
const swap = (
  overrides: Partial<{ tokenIn: Address; tokenOut: Address; recipient: Address; limitSqrtPrice: bigint }> = {},
  value?: bigint,
): FlowTx => ({
  to: LIST.swaprRouter,
  data: encodeFunctionData({
    abi: ALGEBRA_ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: b1.outcome,
        tokenOut: b1.upToken,
        recipient: owner,
        deadline: CHAIN_TIME,
        amountIn: 7n,
        amountOutMinimum: 1n,
        limitSqrtPrice: 2n ** 96n,
        ...overrides,
      },
    ],
  }),
  ...(value === undefined ? {} : { value }),
});
const transfer = (token: Address): FlowTx => ({
  to: token,
  data: encodeFunctionData({
    abi: parseAbi(["function transfer(address to, uint256 amount)"]),
    functionName: "transfer",
    args: [owner, 7n],
  }),
});

const check = (tx: FlowTx, from?: Address) => departures({ tx, session: s, owner, ...(from ? { from } : {}) });

describe("liquidity allow-list fixtures", () => {
  it("encode the selectors the frozen allow-list names", () => {
    const listed = [...LIST.calls.map((call) => call.selector), ...LIST.multicallInner.map((call) => call.selector)];
    const ours = [
      ...NFPM_ABI.map((item) => toFunctionSelector(item)),
      toFunctionSelector(APPROVE_ABI[0]),
      toFunctionSelector(ALGEBRA_ROUTER_ABI[0]),
      ...["splitPosition", "splitFromBase", "mergePositions"].map((name) =>
        toFunctionSelector(
          gnosisRouterAbi.find(
            (item): item is Extract<(typeof gnosisRouterAbi)[number], { type: "function" }> =>
              item.type === "function" && item.name === name,
          )!,
        ),
      ),
    ];

    expect([...ours].sort()).toEqual([...listed].sort());
  });
});

describe("liquidity transaction allow-list (L4, L5)", () => {
  it.each([
    ["an approval of a session token to the position manager", approve(b1.upToken)],
    ["an approval of the collateral to the router", approve(sDai, LIST.gnosisRouter)],
    ["a parent split of sDAI", router("splitPosition", sDai, s.parentMarket)],
    ["a branch split of sDAI", router("splitPosition", sDai, b2.childMarket)],
    ["an xDAI split at the parent", splitFromBase(s.parentMarket)],
    ["a branch merge", router("mergePositions", sDai, b1.childMarket)],
    ["a parent merge", router("mergePositions", sDai, s.parentMarket)],
    [
      "a create and its mint for a session pair",
      multicall([create(upPair), mint(upPair), create(downPair), mint(downPair)]),
    ],
    ["a mint into an existing session pool", multicall([mint(downPair)])],
    ["a withdrawal to the owner", multicall([decrease, collect(), burn])],
    ["a realign swap paying the owner", swap()],
  ] satisfies [string, FlowTx][])("accepts %s", (_, tx) => {
    expect(check(tx, owner)).toEqual([]);
  });

  it.each([
    ["a call to an unlisted target", approve(stranger)],
    ["a transfer of a session token", transfer(b1.outcome)],
    ["an unlisted router call", { to: LIST.gnosisRouter, data: "0xdeadbeef" }],
    ["a position manager call outside a multicall", { to: LIST.positionManager, data: mint(upPair) }],
    ["an approval to another spender", approve(b1.upToken, stranger)],
    ["an unbounded approval", approve(b1.upToken, LIST.positionManager, 2n ** 256n - 1n)],
    ["native value on an approval", approve(b1.upToken, LIST.positionManager, 7n, 1n)],
    ["a split of another collateral", router("splitPosition", b1.outcome, s.parentMarket)],
    ["a split of a market not of this session", router("splitPosition", sDai, stranger)],
    ["native value on a split", router("splitPosition", sDai, s.parentMarket, 1n)],
    ["a merge of another collateral", router("mergePositions", stranger, b1.childMarket)],
    ["a merge of a market not of this session", router("mergePositions", sDai, stranger)],
    ["an xDAI split of a market not of this session", splitFromBase(stranger)],
    ["native value on a multicall", multicall([mint(upPair)], 1n)],
    [
      "an unlisted call inside a multicall",
      multicall([encodeFunctionData({ abi: APPROVE_ABI, functionName: "approve", args: [stranger, 7n] })]),
    ],
    ["a multicall inside a multicall", multicall([multicall([mint(upPair)]).data!])],
    ["a mint paying someone else", multicall([mint(upPair, stranger)])],
    ["a mint paying the zero address", multicall([mint(upPair, zeroAddress)])],
    ["a collect paying someone else", multicall([decrease, collect(stranger), burn])],
    ["a create whose mint names another pair", multicall([create(upPair), mint(downPair)])],
    [
      "a pool pairing one branch's outcome with another branch's child",
      multicall([create(sortPair(b1.outcome, b2.upToken)), mint(sortPair(b1.outcome, b2.upToken))]),
    ],
    ["a mint into a pair not of this session", multicall([mint(sortPair(b1.outcome, stranger))])],
    ["a swap paying someone else", swap({ recipient: stranger })],
    ["a swap without a price limit", swap({ limitSqrtPrice: 0n })],
    ["a swap across a pair not of this session", swap({ tokenIn: b1.outcome, tokenOut: b2.downToken })],
    ["native value on a swap", swap({}, 1n)],
  ] satisfies [string, FlowTx][])("refuses %s", (_, tx) => {
    expect(check(tx, owner)).not.toEqual([]);
  });

  it("refuses a send from anyone other than the run's owner", () => {
    expect(check(approve(b1.upToken), stranger)).not.toEqual([]);
  });

  it("refuses a chain without an allow-list", () => {
    expect(departures({ tx: approve(b1.upToken), session: { ...s, chainId: 999_999 }, owner })).not.toEqual([]);
  });

  it("throws UnlistedTxError where a transaction departs, and nothing where it keeps to the list", () => {
    expect(() => assertListed({ tx: approve(b1.upToken, stranger), session: s, owner })).toThrow(UnlistedTxError);
    expect(() => assertListed({ tx: approve(b1.upToken), session: s, owner, from: owner })).not.toThrow();
  });
});

describe("built liquidity runs against the allow-list (L13)", () => {
  it("passes every transaction of a seed into new and live pools", () => {
    const plan = planSeed({
      session: s,
      owner,
      total: 10n ** 21n,
      collateral: "sDAI",
      chainTime: CHAIN_TIME,
      branches: [
        { depth: 10n ** 21n, upPriceBps: 3_000n, pools: { up: missing, down: missing } },
        {
          depth: 10n ** 20n,
          upPriceBps: 6_000n,
          pools: {
            up: missing,
            down: {
              status: "live",
              sqrtPriceX96: userSqrtPrice(4_000n, false),
              liquidity: 10n ** 21n,
              tickSpacing: 60,
            },
          },
        },
      ],
    });

    for (const tx of txsOf(plan.steps)) expect(check(tx, owner)).toEqual([]);
  });

  it("passes an xDAI seed's native split", () => {
    const plan = planSeed({
      session: s,
      owner,
      total: 10n ** 21n,
      collateral: "xDAI",
      previewDeposit: (10n ** 21n * 9n) / 10n,
      chainTime: CHAIN_TIME,
      branches: s.branches.map(() => ({
        depth: 10n ** 21n,
        upPriceBps: 5_000n,
        pools: { up: missing, down: missing },
      })),
    });

    for (const tx of txsOf(plan.steps)) expect(check(tx, owner)).toEqual([]);
  });

  it("passes a remove and the merge after it", () => {
    const remove = planRemove({
      chainId: 100,
      owner,
      chainTime: CHAIN_TIME,
      sqrtPriceX96: userSqrtPrice(5_000n, true),
      position: { tokenId: 5n, token0: upPair[0], token1: upPair[1], tickLower, tickUpper, liquidity: 10n ** 20n },
    });
    const merge = planMerge({
      session: s,
      owner,
      balances: {
        branches: [
          { outcome: 3n, up: 10n, down: 10n, invalid: 10n },
          { outcome: 20n, up: 1n, down: 2n, invalid: 3n },
        ],
        parentInvalid: 13n,
      },
    });

    for (const tx of [remove.tx, ...merge.txs]) expect(check(tx, owner)).toEqual([]);
  });
});

describe("a whole seed against the allow-list", () => {
  it("lists every transaction of a seed that realigns both pools of a branch", () => {
    const realigning = session([branch(1)]);
    // Both pools priced at UP 0.01 by someone else, the user asking 0.5: each gets a realign.
    const hostile = (childIsToken0: boolean): PoolStateInput => ({
      status: "empty",
      sqrtPriceX96: userSqrtPrice(100n, childIsToken0),
      tickSpacing: NEW_POOL_TICK_SPACING,
    });
    const plan = planSeed({
      session: realigning,
      owner,
      total: 10n ** 21n,
      collateral: "sDAI",
      chainTime: CHAIN_TIME,
      branches: [{ depth: 10n ** 21n, upPriceBps: 5_000n, pools: { up: hostile(true), down: hostile(false) } }],
    });
    const txs = txsOf(plan.steps);

    expect(txs.filter((tx) => same(tx.to, LIST.swaprRouter))).toHaveLength(2);
    expect(txs.flatMap((tx) => departures({ tx, session: realigning, owner }))).toEqual([]);
  });
});

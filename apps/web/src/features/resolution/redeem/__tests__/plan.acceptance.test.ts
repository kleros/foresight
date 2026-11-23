import type { FlowTx } from "@foresight/tx-orchestrator";
import fc from "fast-check";
import {
  decodeFunctionData,
  erc20Abi,
  getAddress,
  isAddressEqual,
  parseAbi,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import { describe, expect, it } from "vitest";

import { executorAddress } from "@/lib/trade-executor/executor";

import { tradeExecutorAbi, tradeExecutorFactoryAddress } from "@/config/contracts";

import type { ChildResolution, ParentResolution, SessionResolution } from "../../api/getSessionResolution";
import { REDEEM_ALLOW_LIST } from "../../oracle/allowlist";
import { planTradeWalletRedeem, type TradeWalletRedeemInput } from "../plan";

/** Money properties: `oracle/PROPERTIES.md` R1 to R5. Calls: `oracle/allowlist.ts`. */

const CHAIN_ID = 100;
const LIST = REDEEM_ALLOW_LIST[CHAIN_ID]!;
const FACTORY = tradeExecutorFactoryAddress(CHAIN_ID)!;
const WAD = 10n ** 18n;

/** Fixed so a failure names a reproducible case; fast-check prints the shrunk counterexample. */
const RUNS = { seed: 20261121, numRuns: 200 } as const;

const at = (prefix: string): Address => getAddress(`0x${prefix.padEnd(40, "0")}`);
const same = (a: Address, b: Address) => isAddressEqual(a, b);

const SDAI = at("af");
const PARENT = at("b0");
const OWNER = at("1a01");
const OTHER_OWNER = at("1a02");
const childMarket = (index: number) => at(`c${index + 1}`);
const parentToken = (index: number) => at(`e0${index}`);
const childToken = (index: number, slot: number) => at(`d${index}${slot}`);

/** The redeem signatures; a test below holds them to the oracle's names. */
const REDEEM_SIGNATURES = [
  "function redeemPositions(address,address,uint256[],uint256[])",
  "function redeemConditionalToCollateral(address,address,uint256[],uint256[],uint256[])",
] as const;
const ORACLE_ABI = parseAbi(REDEEM_SIGNATURES);
const SELECTORS = new Set(LIST.calls.map((call) => call.selector.toLowerCase()));

const DOWN = 0;
const UP = 1;
const INVALID = 2;

type Holding = { token: Address; balance: bigint };

interface SessionSpec {
  optionCount: number;
  parent: ParentResolution;
  children: Partial<Record<number, ChildResolution>>;
  /** Options then INVALID. */
  parentBalances: bigint[];
  /** [DOWN, UP, INVALID] per option. */
  childBalances: Partial<Record<number, [bigint, bigint, bigint]>>;
  owner?: Address;
}

function input(spec: SessionSpec): TradeWalletRedeemInput {
  const parentTokens: Holding[] = Array.from({ length: spec.optionCount + 1 }, (_, index) => ({
    token: parentToken(index),
    balance: spec.parentBalances[index] ?? 0n,
  }));
  const childTokens: Partial<Record<number, Holding[]>> = {};
  for (let index = 0; index < spec.optionCount; index++) {
    const balances = spec.childBalances[index] ?? [0n, 0n, 0n];
    childTokens[index] = balances.map((balance, slot) => ({ token: childToken(index, slot), balance }));
  }
  const resolution: SessionResolution = { parent: spec.parent, children: spec.children };
  return {
    chainId: CHAIN_ID,
    owner: spec.owner ?? OWNER,
    collateral: SDAI,
    parentMarket: PARENT,
    resolution,
    parentTokens,
    childTokens,
  };
}

/** The parent resolved with these numerators, options then INVALID. */
function resolvedParent(numerators: bigint[]): ParentResolution {
  const options = numerators.length - 1;
  return {
    resolved: true,
    invalid: numerators[options] !== 0n,
    winningOutcomes: numerators.slice(0, options).flatMap((each, index) => (each === 0n ? [] : [index])),
    payoutNumerators: numerators,
    payoutDenominator: numerators.reduce((sum, each) => sum + each, 0n),
  };
}

/** A child resolved to `value` on 0..100, as Seer's RealityProxy pays it; numerators 1e18-scaled. */
function valuedChild(index: number, value: bigint): ChildResolution {
  const numerators = [100n * WAD - value * WAD, value * WAD, 0n];
  return {
    deployed: true,
    market: childMarket(index),
    resolved: true,
    invalid: false,
    finalValue: Number(value),
    payoutNumerators: numerators,
    payoutDenominator: 100n * WAD,
  };
}

function invalidChild(index: number): ChildResolution {
  return {
    deployed: true,
    market: childMarket(index),
    resolved: true,
    invalid: true,
    finalValue: null,
    payoutNumerators: [0n, 0n, 1n],
    payoutDenominator: 1n,
  };
}

const unresolvedChild = (index: number): ChildResolution => ({
  deployed: true,
  market: childMarket(index),
  resolved: false,
});

type Inner =
  | { kind: "approve"; token: Address; spender: Address; amount: bigint }
  | { kind: "parent"; router: Address; collateral: Address; market: Address; indexes: bigint[]; amounts: bigint[] }
  | {
      kind: "child";
      router: Address;
      collateral: Address;
      market: Address;
      indexes: bigint[];
      parentIndexes: bigint[];
      amounts: bigint[];
    };

/** The calls of a trade wallet batch, decoded against the oracle's signatures; anything else throws. */
function innerCalls(tx: FlowTx): Inner[] {
  const outer = decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data! });
  if (outer.functionName !== "batchExecute") throw new Error(`not a batchExecute: ${outer.functionName}`);
  return outer.args[0].map(({ to, data }: { to: Address; data: Hex }) => {
    const selector = data.slice(0, 10).toLowerCase();
    if (!SELECTORS.has(selector)) throw new Error(`selector ${selector} on ${to} is outside the allow-list`);
    if (selector === "0x095ea7b3") {
      const { args } = decodeFunctionData({ abi: erc20Abi, data });
      if (!args) throw new Error("approve without args");
      const [spender, amount] = args as readonly [Address, bigint];
      return { kind: "approve", token: to, spender, amount } as const;
    }
    const decoded = decodeFunctionData({ abi: ORACLE_ABI, data });
    if (decoded.functionName === "redeemPositions") {
      const [collateral, market, indexes, amounts] = decoded.args as readonly [Address, Address, bigint[], bigint[]];
      return { kind: "parent", router: to, collateral, market, indexes: [...indexes], amounts: [...amounts] } as const;
    }
    if (decoded.functionName === "redeemConditionalToCollateral") {
      const [collateral, market, indexes, parentIndexes, amounts] = decoded.args as readonly [
        Address,
        Address,
        bigint[],
        bigint[],
        bigint[],
      ];
      return {
        kind: "child",
        router: to,
        collateral,
        market,
        indexes: [...indexes],
        parentIndexes: [...parentIndexes],
        amounts: [...amounts],
      } as const;
    }
    throw new Error(`unexpected call ${selector} on ${to}`);
  });
}

/** Which token each redeemed index pulls, by market. */
function tokenOf(market: Address, index: bigint): Address {
  if (same(market, PARENT)) return parentToken(Number(index));
  for (let option = 0; option < 10; option++) {
    if (same(market, childMarket(option))) return childToken(option, Number(index));
  }
  throw new Error(`no session market ${market}`);
}

/** index → amount redeemed, per market, across every redeem call of the batch. */
function redeemed(calls: Inner[]): Map<string, Map<number, bigint>> {
  const byMarket = new Map<string, Map<number, bigint>>();
  for (const call of calls) {
    if (call.kind === "approve") continue;
    const entries = byMarket.get(call.market.toLowerCase()) ?? new Map<number, bigint>();
    call.indexes.forEach((index, position) => {
      if (entries.has(Number(index))) throw new Error(`index ${index} of ${call.market} redeemed twice`);
      entries.set(Number(index), call.amounts[position]!);
    });
    byMarket.set(call.market.toLowerCase(), entries);
  }
  return byMarket;
}

const plainMap = (entries: Map<number, bigint> | undefined) =>
  Object.fromEntries([...(entries ?? new Map<number, bigint>())].sort(([a], [b]) => a - b));

/**
 * The approve checks R2 and A3 ask for: each redeemed index has its own approve, earlier in the batch, on that
 * index's token, naming the router the redeem goes to, for exactly the amount redeemed; and no approve is left over.
 */
function expectApprovalsMatch(calls: Inner[]) {
  const used = new Set<number>();
  calls.forEach((call, position) => {
    if (call.kind === "approve") return;
    const router = call.kind === "parent" ? LIST.gnosisRouter : LIST.conditionalRouter;
    expect(same(call.router, router)).toBe(true);
    call.indexes.forEach((index, slot) => {
      const token = tokenOf(call.market, index);
      const approval = calls.findIndex(
        (each, earlier) =>
          earlier < position &&
          !used.has(earlier) &&
          each.kind === "approve" &&
          same(each.token, token) &&
          same(each.spender, router) &&
          each.amount === call.amounts[slot],
      );
      expect(approval, `approve of ${call.amounts[slot]} ${token} to ${router}`).toBeGreaterThanOrEqual(0);
      used.add(approval);
    });
  });
  const approvals = calls.flatMap((call, position) => (call.kind === "approve" ? [position] : []));
  expect(approvals.filter((position) => !used.has(position))).toEqual([]);
}

const floorPay = (amount: bigint, numerator: bigint, denominator: bigint) => (amount * numerator) / denominator;

/** What the session pays, worked out here from R1 and R5: per market, index → amount, and the payout. */
function expectedRedeem(spec: SessionSpec) {
  const parent = spec.parent;
  const markets = new Map<string, { entries: Map<number, bigint>; payout: bigint }>();
  const waiting: number[] = [];
  if (!parent.resolved) return { markets, waiting, payout: 0n };
  const parentEntries = new Map<number, bigint>();
  let parentPayout = 0n;
  for (let index = 0; index <= spec.optionCount; index++) {
    const balance = spec.parentBalances[index] ?? 0n;
    const numerator = parent.payoutNumerators[index] ?? 0n;
    if (balance === 0n || numerator === 0n) continue;
    parentEntries.set(index, balance);
    parentPayout += floorPay(balance, numerator, parent.payoutDenominator);
  }
  if (parentEntries.size > 0) markets.set(PARENT.toLowerCase(), { entries: parentEntries, payout: parentPayout });

  for (let index = 0; index < spec.optionCount; index++) {
    const outcomeNumerator = parent.payoutNumerators[index] ?? 0n;
    if (outcomeNumerator === 0n) continue;
    const child = spec.children[index];
    if (!child || !child.deployed) continue;
    if (!child.resolved) {
      waiting.push(index);
      continue;
    }
    const balances = spec.childBalances[index] ?? [0n, 0n, 0n];
    const entries = new Map<number, bigint>();
    let outcomeTokens = 0n;
    for (const slot of [UP, DOWN, INVALID]) {
      const balance = balances[slot]!;
      const numerator = child.payoutNumerators[slot] ?? 0n;
      if (balance === 0n || numerator === 0n) continue;
      entries.set(slot, balance);
      outcomeTokens += floorPay(balance, numerator, child.payoutDenominator);
    }
    if (entries.size === 0) continue;
    markets.set(child.market.toLowerCase(), {
      entries,
      payout: floorPay(outcomeTokens, outcomeNumerator, parent.payoutDenominator),
    });
  }
  const payout = [...markets.values()].reduce((sum, each) => sum + each.payout, 0n);
  return { markets, waiting, payout };
}

const partOf = (plan: ReturnType<typeof planTradeWalletRedeem>, market: Address) =>
  plan.parts.find((part) => same(part.market, market));

/** Three options; 0 and 1 won, 2 lost; both winners' children valued; holdings in every token. */
function twoWinnersOneLoser(owner: Address = OWNER): SessionSpec {
  return {
    optionCount: 3,
    parent: resolvedParent([1n, 1n, 0n, 0n]),
    children: { 0: valuedChild(0, 42n), 1: valuedChild(1, 73n), 2: valuedChild(2, 10n) },
    parentBalances: [5n * WAD + 1n, 6n * WAD - 3n, 7n * WAD, 9n * WAD],
    childBalances: {
      0: [4n * WAD - 1_234_567_891n, 4n * WAD, 4n * WAD],
      1: [3n * WAD, 3n * WAD - 987_654_321n, 3n * WAD],
      2: [2n * WAD, 2n * WAD, 2n * WAD],
    },
    owner,
  };
}

describe("the oracle the planner is decoded against", () => {
  it("lists selectors that match its own signatures, including the two redeems decoded here", () => {
    for (const call of LIST.calls) {
      expect(toFunctionSelector(`function ${call.name}`)).toBe(call.selector);
    }
    const names = LIST.calls.map((call) => `function ${call.name}`);
    for (const signature of REDEEM_SIGNATURES) expect(names).toContain(signature);
  });
});

describe("A3 the calls a trade wallet redeem plans", () => {
  it("sends one batchExecute, with no native value, to the connected account's own trade wallet, for two owners", () => {
    for (const owner of [OWNER, OTHER_OWNER]) {
      const plan = planTradeWalletRedeem(input(twoWinnersOneLoser(owner)));

      expect(plan.tx).not.toBeNull();
      expect(same(plan.tx!.to, executorAddress(FACTORY, owner))).toBe(true);
      expect(plan.tx!.value ?? 0n).toBe(0n);
      expect(decodeFunctionData({ abi: tradeExecutorAbi, data: plan.tx!.data! }).functionName).toBe("batchExecute");
    }
    const first = planTradeWalletRedeem(input(twoWinnersOneLoser(OWNER)));
    const second = planTradeWalletRedeem(input(twoWinnersOneLoser(OTHER_OWNER)));
    expect(same(first.tx!.to, second.tx!.to)).toBe(false);
  });

  it("holds only approves and the two redeem selectors, so no transfer, each on its listed target", () => {
    const calls = innerCalls(planTradeWalletRedeem(input(twoWinnersOneLoser())).tx!);
    const sessionTokens = [
      ...Array.from({ length: 4 }, (_, index) => parentToken(index)),
      ...[0, 1, 2].flatMap((index) => [0, 1, 2].map((slot) => childToken(index, slot))),
    ];

    expect(calls.map((call) => call.kind)).toContain("parent");
    expect(calls.map((call) => call.kind)).toContain("child");
    for (const call of calls) {
      if (call.kind === "approve") {
        expect(sessionTokens.some((token) => same(token, call.token))).toBe(true);
        expect([LIST.gnosisRouter, LIST.conditionalRouter].some((router) => same(router, call.spender))).toBe(true);
      } else if (call.kind === "parent") {
        expect(same(call.router, LIST.gnosisRouter)).toBe(true);
        expect(same(call.collateral, SDAI)).toBe(true);
        expect(same(call.market, PARENT)).toBe(true);
      } else {
        expect(same(call.router, LIST.conditionalRouter)).toBe(true);
        expect(same(call.collateral, SDAI)).toBe(true);
      }
    }
  });

  it("approves exactly each redeemed amount, before its redeem, to the exact router, never unbounded", () => {
    const calls = innerCalls(planTradeWalletRedeem(input(twoWinnersOneLoser())).tx!);

    expectApprovalsMatch(calls);
    const maxUint = 2n ** 256n - 1n;
    for (const call of calls) if (call.kind === "approve") expect(call.amount).toBeLessThan(maxUint);
  });

  it("redeems the full balance of each paying token: both winners' parent tokens and both winners' UP and DOWN", () => {
    const spec = twoWinnersOneLoser();
    const byMarket = redeemed(innerCalls(planTradeWalletRedeem(input(spec)).tx!));

    expect(plainMap(byMarket.get(PARENT.toLowerCase()))).toEqual({ 0: 5n * WAD + 1n, 1: 6n * WAD - 3n });
    expect(plainMap(byMarket.get(childMarket(0).toLowerCase()))).toEqual({
      [DOWN]: 4n * WAD - 1_234_567_891n,
      [UP]: 4n * WAD,
    });
    expect(plainMap(byMarket.get(childMarket(1).toLowerCase()))).toEqual({
      [DOWN]: 3n * WAD,
      [UP]: 3n * WAD - 987_654_321n,
    });
  });

  it("names each child's own parent outcome and orders its indexes UP, DOWN, INVALID with amounts in place", () => {
    const calls = innerCalls(planTradeWalletRedeem(input(twoWinnersOneLoser())).tx!);
    const childCalls = calls.filter((call): call is Extract<Inner, { kind: "child" }> => call.kind === "child");

    expect(childCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of childCalls) {
      const option = [0, 1, 2].find((index) => same(call.market, childMarket(index)))!;
      expect(call.parentIndexes).toEqual([BigInt(option)]);
      const order = call.indexes.map((index) => [1n, 0n, 2n].indexOf(index));
      expect(order.every((rank) => rank >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(call.amounts).toHaveLength(call.indexes.length);
    }
  });

  it("gives two losing options no call, though the trade wallet holds their parent and child tokens", () => {
    const spec: SessionSpec = {
      optionCount: 4,
      parent: resolvedParent([1n, 0n, 1n, 0n, 0n]),
      children: { 0: valuedChild(0, 30n), 1: valuedChild(1, 60n), 2: valuedChild(2, 80n), 3: valuedChild(3, 20n) },
      parentBalances: [WAD, 2n * WAD, 3n * WAD, 4n * WAD, 0n],
      childBalances: {
        0: [WAD, WAD, 0n],
        1: [2n * WAD, 2n * WAD, 2n * WAD],
        2: [WAD, WAD, 0n],
        3: [3n * WAD, 3n * WAD, 3n * WAD],
      },
    };
    const calls = innerCalls(planTradeWalletRedeem(input(spec)).tx!);
    const byMarket = redeemed(calls);
    const losingTokens = [1, 3].flatMap((option) => [
      parentToken(option),
      ...[0, 1, 2].map((slot) => childToken(option, slot)),
    ]);

    expect(Object.keys(plainMap(byMarket.get(PARENT.toLowerCase())))).toEqual(["0", "2"]);
    expect(byMarket.has(childMarket(1).toLowerCase())).toBe(false);
    expect(byMarket.has(childMarket(3).toLowerCase())).toBe(false);
    for (const call of calls) {
      if (call.kind === "approve") expect(losingTokens.some((token) => same(token, call.token))).toBe(false);
    }
  });

  it("gives two zero balances no index and no approve: a winner's UP and the other winner's parent token", () => {
    const spec: SessionSpec = {
      ...twoWinnersOneLoser(),
      parentBalances: [5n * WAD, 0n, 7n * WAD, 0n],
      childBalances: { 0: [4n * WAD, 0n, 0n], 1: [3n * WAD, 3n * WAD, 0n], 2: [0n, 0n, 0n] },
    };
    const calls = innerCalls(planTradeWalletRedeem(input(spec)).tx!);
    const byMarket = redeemed(calls);

    expect(plainMap(byMarket.get(PARENT.toLowerCase()))).toEqual({ 0: 5n * WAD });
    expect(plainMap(byMarket.get(childMarket(0).toLowerCase()))).toEqual({ [DOWN]: 4n * WAD });
    for (const call of calls) {
      if (call.kind !== "approve") continue;
      expect(same(call.token, childToken(0, UP))).toBe(false);
      expect(same(call.token, parentToken(1))).toBe(false);
      expect(call.amount).toBeGreaterThan(0n);
    }
  });

  it("plans no transaction when the trade wallet holds only losing and zero-payout tokens", () => {
    const spec: SessionSpec = {
      ...twoWinnersOneLoser(),
      parentBalances: [0n, 0n, 7n * WAD, 9n * WAD],
      childBalances: { 0: [0n, 0n, 4n * WAD], 1: [0n, 0n, 0n], 2: [2n * WAD, 2n * WAD, 2n * WAD] },
    };
    const plan = planTradeWalletRedeem(input(spec));

    expect(plan.tx).toBeNull();
    expect(plan.parts).toEqual([]);
    expect(plan.payout).toBe(0n);
  });

  it("plans nothing while the parent has not resolved", () => {
    const spec: SessionSpec = {
      ...twoWinnersOneLoser(),
      parent: { resolved: false },
      children: { 0: valuedChild(0, 42n), 1: valuedChild(1, 73n), 2: valuedChild(2, 10n) },
    };
    const plan = planTradeWalletRedeem(input(spec));

    expect(plan.tx).toBeNull();
    expect(plan.parts).toEqual([]);
  });
});

describe("A2 a winner whose child has not resolved", () => {
  const spec: SessionSpec = {
    ...twoWinnersOneLoser(),
    children: { 0: valuedChild(0, 42n), 1: unresolvedChild(1), 2: unresolvedChild(2) },
  };

  it("plans the resolved winner's child and both winners' parent tokens, and nothing on the waiting child", () => {
    const plan = planTradeWalletRedeem(input(spec));
    const calls = innerCalls(plan.tx!);
    const byMarket = redeemed(calls);

    expect(plainMap(byMarket.get(PARENT.toLowerCase()))).toEqual({ 0: 5n * WAD + 1n, 1: 6n * WAD - 3n });
    expect(Object.keys(plainMap(byMarket.get(childMarket(0).toLowerCase()))).sort()).toEqual(["0", "1"]);
    expect(byMarket.has(childMarket(1).toLowerCase())).toBe(false);
    for (const call of calls) {
      if (call.kind === "approve") {
        for (const slot of [0, 1, 2]) expect(same(call.token, childToken(1, slot))).toBe(false);
      }
    }
    expect(partOf(plan, childMarket(1))).toBeUndefined();
  });

  it("lists the waiting winner as waiting, and neither the resolved winner nor the unresolved loser", () => {
    const plan = planTradeWalletRedeem(input(spec));

    expect(plan.waiting).toEqual([1]);
  });

  it("does not list a waiting winner that holds no child tokens, and plans the other winner's child", () => {
    const plan = planTradeWalletRedeem(
      input({
        ...spec,
        children: { 0: unresolvedChild(0), 1: valuedChild(1, 73n), 2: unresolvedChild(2) },
        childBalances: { 0: [0n, 0n, 0n], 1: [3n * WAD, 3n * WAD, 0n], 2: [2n * WAD, 2n * WAD, 0n] },
      }),
    );
    const byMarket = redeemed(innerCalls(plan.tx!));

    expect(plan.waiting).toEqual([]);
    expect(byMarket.has(childMarket(1).toLowerCase())).toBe(true);
    expect(byMarket.has(childMarket(0).toLowerCase())).toBe(false);
  });

  it("lists both winners as waiting when neither child resolved, still planning their parent tokens", () => {
    const plan = planTradeWalletRedeem(
      input({ ...spec, children: { 0: unresolvedChild(0), 1: unresolvedChild(1), 2: unresolvedChild(2) } }),
    );
    const byMarket = redeemed(innerCalls(plan.tx!));

    expect([...plan.waiting].sort()).toEqual([0, 1]);
    expect([...byMarket.keys()]).toEqual([PARENT.toLowerCase()]);
  });
});

describe("A7 INVALID tokens", () => {
  it("redeems a child's INVALID balance when that child resolved INVALID and its parent outcome pays", () => {
    const spec: SessionSpec = {
      ...twoWinnersOneLoser(),
      children: { 0: invalidChild(0), 1: valuedChild(1, 73n), 2: invalidChild(2) },
      childBalances: {
        0: [4n * WAD, 4n * WAD, 4n * WAD - 17n],
        1: [3n * WAD, 3n * WAD, 3n * WAD],
        2: [2n * WAD, 2n * WAD, 2n * WAD],
      },
    };
    const plan = planTradeWalletRedeem(input(spec));
    const calls = innerCalls(plan.tx!);
    const byMarket = redeemed(calls);

    expect(plainMap(byMarket.get(childMarket(0).toLowerCase()))).toEqual({ [INVALID]: 4n * WAD - 17n });
    expect(plainMap(byMarket.get(childMarket(1).toLowerCase()))).toEqual({ [DOWN]: 3n * WAD, [UP]: 3n * WAD });
    expect(byMarket.has(childMarket(2).toLowerCase())).toBe(false);
    expectApprovalsMatch(calls);
    expect(partOf(plan, childMarket(0))!.payout).toBe(floorPay(4n * WAD - 17n, 1n, 2n));
  });

  it("redeems the parent's INVALID tokens when the parent resolved INVALID, and no option or child", () => {
    const spec: SessionSpec = {
      ...twoWinnersOneLoser(),
      parent: resolvedParent([0n, 0n, 0n, 1n]),
      parentBalances: [5n * WAD, 6n * WAD, 7n * WAD, 9n * WAD - 5n],
    };
    const plan = planTradeWalletRedeem(input(spec));
    const calls = innerCalls(plan.tx!);
    const byMarket = redeemed(calls);

    expect([...byMarket.keys()]).toEqual([PARENT.toLowerCase()]);
    expect(plainMap(byMarket.get(PARENT.toLowerCase()))).toEqual({ 3: 9n * WAD - 5n });
    expectApprovalsMatch(calls);
    expect(plan.payout).toBe(9n * WAD - 5n);
  });

  it("gives a zero INVALID payout no index: a valued child's INVALID and a valid parent's INVALID", () => {
    const calls = innerCalls(planTradeWalletRedeem(input(twoWinnersOneLoser())).tx!);
    const byMarket = redeemed(calls);

    expect(plainMap(byMarket.get(PARENT.toLowerCase()))[3]).toBeUndefined();
    expect(plainMap(byMarket.get(childMarket(0).toLowerCase()))[INVALID]).toBeUndefined();
    expect(plainMap(byMarket.get(childMarket(1).toLowerCase()))[INVALID]).toBeUndefined();
    for (const call of calls) {
      if (call.kind !== "approve") continue;
      expect(same(call.token, parentToken(3))).toBe(false);
      expect(same(call.token, childToken(0, INVALID))).toBe(false);
    }
  });

  it("gives a child INVALID balance no call when its child resolved INVALID but its parent outcome lost", () => {
    const spec: SessionSpec = {
      ...twoWinnersOneLoser(),
      children: { 0: valuedChild(0, 42n), 1: valuedChild(1, 73n), 2: invalidChild(2) },
    };
    const byMarket = redeemed(innerCalls(planTradeWalletRedeem(input(spec)).tx!));

    expect(byMarket.has(childMarket(2).toLowerCase())).toBe(false);
  });
});

describe("A8 a child part's shown payout", () => {
  it("floors each child token, then the parent outcome's fraction, with one parent winner", () => {
    // 1 wei UP and 1 wei DOWN at 42/58 pay 0 floored per token, 1 if summed before the floor
    const spec: SessionSpec = {
      optionCount: 2,
      parent: resolvedParent([1n, 0n, 0n]),
      children: { 0: valuedChild(0, 42n), 1: valuedChild(1, 50n) },
      parentBalances: [0n, 0n, 0n],
      childBalances: { 0: [1n, 1n, 0n] },
    };
    const plan = planTradeWalletRedeem(input(spec));

    expect(partOf(plan, childMarket(0))?.payout ?? 0n).toBe(0n);
    expect(plan.payout).toBe(0n);
  });

  it("floors the child payout before the parent outcome's fraction, with two parent winners", () => {
    // UP 19 wei at 1/10 floors to 1 parent token, which at 3/4 floors to 0; one combined floor would give 1
    const spec: SessionSpec = {
      optionCount: 2,
      parent: resolvedParent([3n, 1n, 0n]),
      children: { 0: valuedChild(0, 10n), 1: valuedChild(1, 50n) },
      parentBalances: [0n, 0n, 0n],
      childBalances: { 0: [0n, 19n, 0n], 1: [0n, 0n, 0n] },
    };
    const plan = planTradeWalletRedeem(input(spec));

    expect(partOf(plan, childMarket(0))?.payout ?? 0n).toBe(0n);
    expect(plan.payout).toBe(0n);
  });

  it("adds a floored child part to a parent part, with two parent winners", () => {
    // child 0: UP 19 at 1/10 → 1 parent token, at 3/4 → 0; parent token 0: 10 at 3/4 → 7; parent token 1: 9 at 1/4 → 2
    const spec: SessionSpec = {
      optionCount: 2,
      parent: resolvedParent([3n, 1n, 0n]),
      children: { 0: valuedChild(0, 10n), 1: valuedChild(1, 50n) },
      parentBalances: [10n, 9n, 0n],
      childBalances: { 0: [0n, 19n, 0n], 1: [0n, 0n, 0n] },
    };
    const plan = planTradeWalletRedeem(input(spec));

    expect(partOf(plan, PARENT)!.payout).toBe(9n);
    expect(partOf(plan, childMarket(0))?.payout ?? 0n).toBe(0n);
    expect(plan.payout).toBe(9n);
  });

  it("sums the floored UP and DOWN payouts into parent tokens before the parent fraction, with two winners", () => {
    // DOWN 3 at 58/100 → 1, UP 3 at 42/100 → 1: 2 parent tokens at 1/2 → 1; flooring each side at 1/2 gives 0
    const spec: SessionSpec = {
      optionCount: 2,
      parent: resolvedParent([1n, 1n, 0n]),
      children: { 0: valuedChild(0, 42n), 1: valuedChild(1, 50n) },
      parentBalances: [0n, 0n, 0n],
      childBalances: { 0: [3n, 3n, 0n], 1: [0n, 0n, 0n] },
    };
    const plan = planTradeWalletRedeem(input(spec));

    expect(partOf(plan, childMarket(0))!.payout).toBe(1n);
    expect(plan.payout).toBe(1n);
  });

  const amount = fc.oneof(fc.constant(0n), fc.bigInt({ min: 1n, max: 10n ** 24n }));
  const childValue = fc.bigInt({ min: 0n, max: 100n });

  it("equals both floored steps over generated balances and answers, for one parent winner", () => {
    fc.assert(
      fc.property(amount, amount, amount, childValue, (down, up, invalid, value) => {
        const spec: SessionSpec = {
          optionCount: 2,
          parent: resolvedParent([1n, 0n, 0n]),
          children: { 0: valuedChild(0, value), 1: valuedChild(1, 50n) },
          parentBalances: [0n, 0n, 0n],
          childBalances: { 0: [down, up, invalid] },
        };
        const expected = expectedRedeem(spec).markets.get(childMarket(0).toLowerCase())?.payout ?? 0n;
        expect(partOf(planTradeWalletRedeem(input(spec)), childMarket(0))?.payout ?? 0n).toBe(expected);
      }),
      RUNS,
    );
  });

  it("equals both floored steps over generated balances, answers and parent numerators, for two parent winners", () => {
    const numerator = fc.bigInt({ min: 1n, max: 10n ** 18n });
    fc.assert(
      fc.property(amount, amount, childValue, numerator, numerator, (down, up, value, first, second) => {
        const spec: SessionSpec = {
          optionCount: 3,
          parent: resolvedParent([first, 0n, second, 0n]),
          children: { 0: valuedChild(0, value), 1: valuedChild(1, 50n), 2: valuedChild(2, 100n - value) },
          parentBalances: [0n, 0n, 0n, 0n],
          childBalances: { 0: [down, up, 0n], 2: [up, down, 0n] },
        };
        const plan = planTradeWalletRedeem(input(spec));
        const expected = expectedRedeem(spec);
        for (const option of [0, 2]) {
          expect(partOf(plan, childMarket(option))?.payout ?? 0n).toBe(
            expected.markets.get(childMarket(option).toLowerCase())?.payout ?? 0n,
          );
        }
        expect(plan.payout).toBe(expected.payout);
      }),
      RUNS,
    );
  });
});

describe("A2, A3, A7 and A8 over generated sessions", () => {
  // from 1e6 wei, every paying token pays at least 1 wei after both floors, so no part is dust
  const balance = fc.oneof(fc.constant(0n), fc.bigInt({ min: 10n ** 6n, max: 10n ** 24n }));
  const childState = fc.oneof(
    fc.constant("unresolved" as const),
    fc.constant("invalid" as const),
    fc.bigInt({ min: 0n, max: 100n }),
  );
  const session = fc.integer({ min: 2, max: 4 }).chain((optionCount) =>
    fc.record({
      optionCount: fc.constant(optionCount),
      numerators: fc
        .array(fc.oneof(fc.constant(0n), fc.bigInt({ min: 1n, max: 5n })), {
          minLength: optionCount + 1,
          maxLength: optionCount + 1,
        })
        .filter((each) => each.some((numerator) => numerator > 0n)),
      children: fc.array(childState, { minLength: optionCount, maxLength: optionCount }),
      parentBalances: fc.array(balance, { minLength: optionCount + 1, maxLength: optionCount + 1 }),
      childBalances: fc.array(fc.tuple(balance, balance, balance), { minLength: optionCount, maxLength: optionCount }),
      owner: fc.constantFrom(OWNER, OTHER_OWNER),
    }),
  );
  type Generated = typeof session extends fc.Arbitrary<infer T> ? T : never;

  const specOf = (generated: Generated): SessionSpec => ({
    optionCount: generated.optionCount,
    parent: resolvedParent(generated.numerators),
    children: Object.fromEntries(
      generated.children.map((state, index) => [
        index,
        state === "unresolved"
          ? unresolvedChild(index)
          : state === "invalid"
            ? invalidChild(index)
            : valuedChild(index, state),
      ]),
    ),
    parentBalances: generated.parentBalances,
    childBalances: Object.fromEntries(generated.childBalances.map((each, index) => [index, each])),
    owner: generated.owner,
  });

  it("redeems exactly the paying non-zero balances, approved one for one, with the payout from both floors", () => {
    fc.assert(
      fc.property(session, (generated) => {
        const spec = specOf(generated);
        const plan = planTradeWalletRedeem(input(spec));
        const expected = expectedRedeem(spec);

        expect(plan.payout).toBe(expected.payout);
        if (expected.markets.size === 0) {
          expect(plan.tx).toBeNull();
          expect(plan.parts).toEqual([]);
          return;
        }
        expect(plan.tx).not.toBeNull();
        expect(same(plan.tx!.to, executorAddress(FACTORY, spec.owner!))).toBe(true);
        const calls = innerCalls(plan.tx!);
        expectApprovalsMatch(calls);
        const byMarket = redeemed(calls);
        expect([...byMarket.keys()].sort()).toEqual([...expected.markets.keys()].sort());
        for (const [market, { entries, payout }] of expected.markets) {
          expect(plainMap(byMarket.get(market))).toEqual(plainMap(entries));
          expect(partOf(plan, market as Address)?.payout).toBe(payout);
        }
        expect(plan.parts).toHaveLength(expected.markets.size);
        expect(plan.parts.reduce((sum, part) => sum + part.payout, 0n)).toBe(plan.payout);
      }),
      RUNS,
    );
  });

  it("lists as waiting only winners whose child has not resolved, including each one holding child tokens", () => {
    fc.assert(
      fc.property(session, (generated) => {
        const spec = specOf(generated);
        const plan = planTradeWalletRedeem(input(spec));
        const expected = expectedRedeem(spec);

        for (const index of plan.waiting) expect(expected.waiting).toContain(index);
        for (const index of expected.waiting) {
          const holds = (spec.childBalances[index] ?? []).some((each) => each > 0n);
          if (holds) expect(plan.waiting).toContain(index);
        }
      }),
      RUNS,
    );
  });
});

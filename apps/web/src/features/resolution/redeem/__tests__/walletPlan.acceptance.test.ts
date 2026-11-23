import type { FlowTx } from "@foresight/tx-orchestrator";
import fc from "fast-check";
import { decodeFunctionData, erc20Abi, getAddress, isAddressEqual, parseAbi, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { executorAddress } from "@/lib/trade-executor/executor";

import { tradeExecutorAbi, tradeExecutorFactoryAddress } from "@/config/contracts";

import type { ChildResolution, ParentResolution } from "../../api/getSessionResolution";
import { REDEEM_ALLOW_LIST } from "../../oracle/allowlist";
import { planTradeWalletRedeem, planWalletRedeem, type TradeWalletRedeemInput } from "../plan";

/**
 * The API these tests hold `features/resolution/redeem/plan.ts` to, beside `planTradeWalletRedeem`:
 *
 *   planWalletRedeem(input) → WalletRedeemPlan
 *     input: the fields of TradeWalletRedeemInput, with `owner` the connected account and every balance the
 *            connected account's own.
 *   WalletRedeemPlan = {
 *     parts: { market: Address; payout: bigint }[];
 *     waiting: number[];
 *     payout: bigint;
 *     calls: FlowTx[];   sent from the connected account, in order; [] when nothing is redeemable
 *   }
 *
 * The calls are the approve and redeem calls the trade wallet planner puts in its `batchExecute`, sent from the
 * wallet itself. Money properties: `oracle/PROPERTIES.md` R1 to R5.
 */

const CHAIN_ID = 100;
const LIST = REDEEM_ALLOW_LIST[CHAIN_ID]!;
const FACTORY = tradeExecutorFactoryAddress(CHAIN_ID)!;
const WAD = 10n ** 18n;
const BATCH_EXECUTE = "0xb1bdad27";
const APPROVE = "0x095ea7b3";

/** Fixed so a failure names a reproducible case; fast-check prints the shrunk counterexample. */
const RUNS = { seed: 20261122, numRuns: 200 } as const;

const at = (prefix: string): Address => getAddress(`0x${prefix.padEnd(40, "0")}`);
const same = (a: Address, b: Address) => isAddressEqual(a, b);

const SDAI = at("af");
const PARENT = at("b0");
const OWNER = at("1a01");
const OTHER_OWNER = at("1a02");
const childMarket = (index: number) => at(`c${index + 1}`);
const parentToken = (index: number) => at(`e0${index}`);
const childToken = (index: number, slot: number) => at(`d${index}${slot}`);

const REDEEM_ABI = parseAbi([
  "function redeemPositions(address,address,uint256[],uint256[])",
  "function redeemConditionalToCollateral(address,address,uint256[],uint256[],uint256[])",
]);

type Holding = { token: Address; balance: bigint };

interface SessionSpec {
  optionCount: number;
  parent: ParentResolution;
  children: Partial<Record<number, ChildResolution>>;
  /** Options then INVALID. */
  parentBalances: bigint[];
  /** [DOWN, UP, INVALID] per option. */
  childBalances: Partial<Record<number, bigint[]>>;
}

function input(spec: SessionSpec, owner: Address = OWNER): TradeWalletRedeemInput {
  const parentTokens: Holding[] = Array.from({ length: spec.optionCount + 1 }, (_, index) => ({
    token: parentToken(index),
    balance: spec.parentBalances[index] ?? 0n,
  }));
  const childTokens: Partial<Record<number, Holding[]>> = {};
  for (let index = 0; index < spec.optionCount; index++) {
    const balances = spec.childBalances[index] ?? [0n, 0n, 0n];
    childTokens[index] = balances.map((balance, slot) => ({ token: childToken(index, slot), balance }));
  }
  return {
    chainId: CHAIN_ID,
    owner,
    collateral: SDAI,
    parentMarket: PARENT,
    resolution: { parent: spec.parent, children: spec.children },
    parentTokens,
    childTokens,
  };
}

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

function valuedChild(index: number, value: bigint): ChildResolution {
  return {
    deployed: true,
    market: childMarket(index),
    resolved: true,
    invalid: false,
    finalValue: Number(value),
    payoutNumerators: [100n * WAD - value * WAD, value * WAD, 0n],
    payoutDenominator: 100n * WAD,
  };
}

const invalidChild = (index: number): ChildResolution => ({
  deployed: true,
  market: childMarket(index),
  resolved: true,
  invalid: true,
  finalValue: null,
  payoutNumerators: [0n, 0n, 1n],
  payoutDenominator: 1n,
});

const unresolvedChild = (index: number): ChildResolution => ({
  deployed: true,
  market: childMarket(index),
  resolved: false,
});

const plain = (tx: { to: Address; data?: Hex; value?: bigint }) => ({
  to: tx.to.toLowerCase(),
  data: (tx.data ?? "0x").toLowerCase(),
});

/** The calls inside a trade wallet plan's batchExecute; [] when it plans no batch. */
function batchCalls(tx: FlowTx | null) {
  if (!tx) return [];
  const outer = decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data! });
  if (outer.functionName !== "batchExecute") throw new Error(`not a batchExecute: ${outer.functionName}`);
  return (outer.args[0] as readonly { to: Address; data: Hex }[]).map(plain);
}

/** Which token a redeem of `index` on `market` pulls. */
function tokenOf(market: Address, index: bigint): Address {
  if (same(market, PARENT)) return parentToken(Number(index));
  for (let option = 0; option < 10; option++) {
    if (same(market, childMarket(option))) return childToken(option, Number(index));
  }
  throw new Error(`no session market ${market}`);
}

/** Every approve of `calls` as token|spender|amount, and every amount the redeem calls pull, keyed the same way. */
function approvalsAndPulls(calls: FlowTx[]) {
  const approvals: string[] = [];
  const pulls: string[] = [];
  for (const call of calls) {
    const data = call.data!;
    if (data.toLowerCase().startsWith(APPROVE)) {
      const { args } = decodeFunctionData({ abi: erc20Abi, data });
      const [spender, amount] = args as readonly [Address, bigint];
      expect(amount).toBeGreaterThan(0n);
      approvals.push(`${call.to.toLowerCase()}|${spender.toLowerCase()}|${amount}`);
      continue;
    }
    const decoded = decodeFunctionData({ abi: REDEEM_ABI, data });
    const market = decoded.args[1] as Address;
    const indexes = decoded.args[2] as readonly bigint[];
    const amounts = (
      decoded.functionName === "redeemPositions" ? decoded.args[3] : decoded.args[4]
    ) as readonly bigint[];
    indexes.forEach((index, slot) => {
      pulls.push(`${tokenOf(market, index).toLowerCase()}|${call.to.toLowerCase()}|${amounts[slot]}`);
    });
  }
  return { approvals: approvals.sort(), pulls: pulls.sort() };
}

function expectSameAsTradeWallet(spec: SessionSpec) {
  const wallet = planWalletRedeem(input(spec));
  const trade = planTradeWalletRedeem(input(spec));

  expect(wallet.calls.map(plain)).toEqual(batchCalls(trade.tx));
  expect(wallet.parts).toEqual(trade.parts);
  expect(wallet.waiting).toEqual(trade.waiting);
  expect(wallet.payout).toBe(trade.payout);
  return wallet;
}

function expectSentFromTheWallet(calls: FlowTx[]) {
  const tradeWallets = [OWNER, OTHER_OWNER].map((owner) => executorAddress(FACTORY, owner));
  for (const call of calls) {
    expect(tradeWallets.some((each) => same(each, call.to))).toBe(false);
    expect(call.data!.toLowerCase().startsWith(BATCH_EXECUTE)).toBe(false);
    expect(call.value ?? 0n).toBe(0n);
  }
}

const twoWinnersOneLoser = (): SessionSpec => ({
  optionCount: 3,
  parent: resolvedParent([1n, 1n, 0n, 0n]),
  children: { 0: valuedChild(0, 42n), 1: valuedChild(1, 73n), 2: valuedChild(2, 10n) },
  parentBalances: [5n * WAD + 1n, 6n * WAD - 3n, 7n * WAD, 9n * WAD],
  childBalances: {
    0: [4n * WAD - 1_234_567_891n, 4n * WAD, 4n * WAD],
    1: [3n * WAD, 3n * WAD - 987_654_321n, 3n * WAD],
    2: [2n * WAD, 2n * WAD, 2n * WAD],
  },
});

describe("planWalletRedeem A2 plans the trade wallet planner's calls, sent from the connected wallet", () => {
  it("plans each winner's parent tokens and each resolved winner's child tokens, as the trade wallet batch does", () => {
    const plan = expectSameAsTradeWallet(twoWinnersOneLoser());

    expect(plan.calls.length).toBeGreaterThan(0);
    expect(plan.parts.map((part) => part.market.toLowerCase()).sort()).toEqual(
      [PARENT, childMarket(0), childMarket(1)].map((each) => each.toLowerCase()).sort(),
    );
    expectSentFromTheWallet(plan.calls);
  });

  it("leaves a winner whose child has not resolved waiting, with no calls on its child market", () => {
    const spec = twoWinnersOneLoser();
    spec.children[1] = unresolvedChild(1);

    const plan = expectSameAsTradeWallet(spec);

    expect(plan.waiting).toEqual([1]);
    for (const call of plan.calls) {
      expect([0, 1, 2].some((slot) => same(call.to, childToken(1, slot)))).toBe(false);
    }
  });

  it("redeems a winner's child INVALID balance once that child resolved INVALID", () => {
    const spec: SessionSpec = {
      optionCount: 2,
      parent: resolvedParent([1n, 0n, 0n]),
      children: { 0: invalidChild(0), 1: valuedChild(1, 50n) },
      parentBalances: [2n * WAD - 7n, WAD, 0n],
      childBalances: { 0: [WAD, WAD, WAD - 17n], 1: [WAD, WAD, WAD] },
    };

    const plan = expectSameAsTradeWallet(spec);

    expect(plan.calls.some((call) => same(call.to, childToken(0, 2)))).toBe(true);
    expect(plan.calls.some((call) => same(call.to, childToken(0, 0)))).toBe(false);
  });

  it("redeems the parent's INVALID tokens when the parent resolved INVALID", () => {
    const spec: SessionSpec = {
      optionCount: 2,
      parent: resolvedParent([0n, 0n, 1n]),
      children: { 0: valuedChild(0, 30n), 1: valuedChild(1, 60n) },
      parentBalances: [WAD, WAD, 3n * WAD + 5n],
      childBalances: { 0: [WAD, WAD, WAD], 1: [WAD, WAD, WAD] },
    };

    const plan = expectSameAsTradeWallet(spec);

    expect(plan.parts.map((part) => part.market)).toEqual([PARENT]);
    expect(plan.calls.some((call) => same(call.to, parentToken(2)))).toBe(true);
  });

  it("plans no call while the parent has not resolved", () => {
    const spec = twoWinnersOneLoser();
    spec.parent = { resolved: false };

    const plan = planWalletRedeem(input(spec));

    expect(plan.calls).toEqual([]);
    expect(plan.parts).toEqual([]);
    expect(plan.payout).toBe(0n);
  });

  it("plans no call when the wallet holds only a losing option's tokens", () => {
    const spec = twoWinnersOneLoser();
    spec.parentBalances = [0n, 0n, 7n * WAD, 0n];
    spec.childBalances = { 2: [2n * WAD, 2n * WAD, 2n * WAD] };

    const plan = expectSameAsTradeWallet(spec);

    expect(plan.calls).toEqual([]);
  });

  it("approves each token for exactly the amount its redeem call pulls, to that call's router", () => {
    const { calls } = planWalletRedeem(input(twoWinnersOneLoser()));
    const { approvals, pulls } = approvalsAndPulls(calls);

    expect(approvals).toEqual(pulls);
    for (const call of calls) {
      if (call.data!.toLowerCase().startsWith(APPROVE)) continue;
      expect([LIST.gnosisRouter, LIST.conditionalRouter].some((router) => same(router, call.to))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- generated sessions

const balance = fc.oneof(fc.constant(0n), fc.bigInt({ min: 1n, max: 1_000n }), fc.bigInt({ min: 1n, max: 10n ** 24n }));

const childArb = (index: number) =>
  fc.oneof(
    fc.constant<ChildResolution | undefined>(undefined),
    fc.constant<ChildResolution>({ deployed: false }),
    fc.constant(unresolvedChild(index)),
    fc.constant(invalidChild(index)),
    fc.bigInt({ min: 0n, max: 100n }).map((value) => valuedChild(index, value)),
  );

const sessionArb: fc.Arbitrary<SessionSpec> = fc.integer({ min: 1, max: 4 }).chain((optionCount) =>
  fc.record({
    optionCount: fc.constant(optionCount),
    parent: fc.oneof(
      { weight: 1, arbitrary: fc.constant<ParentResolution>({ resolved: false }) },
      {
        weight: 6,
        arbitrary: fc
          .array(fc.oneof(fc.constant(0n), fc.bigInt({ min: 1n, max: 10n ** 18n })), {
            minLength: optionCount + 1,
            maxLength: optionCount + 1,
          })
          .filter((numerators) => numerators.some((each) => each > 0n))
          .map(resolvedParent),
      },
    ),
    children: fc
      .tuple(...Array.from({ length: optionCount }, (_, index) => childArb(index)))
      .map((list) => Object.fromEntries(list.flatMap((child, index) => (child ? [[index, child]] : [])))),
    parentBalances: fc.array(balance, { minLength: optionCount + 1, maxLength: optionCount + 1 }),
    childBalances: fc
      .array(fc.array(balance, { minLength: 3, maxLength: 3 }), { minLength: optionCount, maxLength: optionCount })
      .map((list) => Object.fromEntries(list.map((balances, index) => [index, balances]))),
  }),
);

describe("planWalletRedeem A2 over generated sessions", () => {
  it("plans the same calls, parts, waiting and payout as the trade wallet batch", () => {
    fc.assert(
      fc.property(sessionArb, (spec) => {
        expectSameAsTradeWallet(spec);
      }),
      RUNS,
    );
  });

  it("sends every call from the wallet: none to a trade wallet, no batchExecute, no native value", () => {
    fc.assert(
      fc.property(sessionArb, (spec) => {
        expectSentFromTheWallet(planWalletRedeem(input(spec)).calls);
      }),
      RUNS,
    );
  });

  it("approves exactly the amounts the redeem calls pull, one approve per pulled token", () => {
    fc.assert(
      fc.property(sessionArb, (spec) => {
        const { approvals, pulls } = approvalsAndPulls(planWalletRedeem(input(spec)).calls);
        expect(approvals).toEqual(pulls);
      }),
      RUNS,
    );
  });

  it("plans the same calls whichever account connects, since no call names a recipient", () => {
    fc.assert(
      fc.property(sessionArb, (spec) => {
        const mine = planWalletRedeem(input(spec, OWNER)).calls.map(plain);
        const theirs = planWalletRedeem(input(spec, OTHER_OWNER)).calls.map(plain);
        expect(theirs).toEqual(mine);
      }),
      RUNS,
    );
  });
});

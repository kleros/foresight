import fc from "fast-check";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";

import type { ChildResolution, ParentResolution, SessionResolution } from "../../api/getSessionResolution";
import { realisedPnl, type RealisedPnlInput, type RedeemRow } from "../realisedPnl";

/**
 * Acceptance tests for issue 2026-11-24-foresight-redeem-7-indexer-pnl, A4, A5 and A7, and its decisions: each
 * option is charged an equal share of every split deposit, and only the trade wallet's own redeems count.
 * Payouts follow oracle R5: floored per token, and a child part floored again at its parent outcome's fraction.
 */

const RUNS = { seed: 20261124, numRuns: 200 } as const;

const TRADE_WALLET = "0x00000000000000000000000000000000000000e1";
/** The trade wallet's owner, redeeming its own tokens from the connected wallet. */
const OWNER = "0x0000000000000000000000000000000000000e01";
const childMarket = (option: number) => `0x${(0xc00 + option).toString(16).padStart(40, "0")}` as Address;

const parentResolved = (payoutNumerators: bigint[], payoutDenominator: bigint): ParentResolution => ({
  resolved: true,
  invalid: false,
  winningOutcomes: payoutNumerators.flatMap((numerator, index) =>
    numerator > 0n && index < payoutNumerators.length - 1 ? [index] : [],
  ),
  payoutNumerators,
  payoutDenominator,
});

/** `payoutNumerators` is [DOWN, UP, INVALID]. */
const childResolved = (option: number, payoutNumerators: bigint[], payoutDenominator: bigint): ChildResolution => {
  const invalid = payoutNumerators[2]! > 0n;
  return {
    deployed: true,
    market: childMarket(option),
    resolved: true,
    invalid,
    finalValue: invalid ? null : 50,
    payoutNumerators,
    payoutDenominator,
  };
};

const childOpen = (option: number): ChildResolution => ({
  deployed: true,
  market: childMarket(option),
  resolved: false,
});

const parentRow = (option: number, payout: bigint, account = TRADE_WALLET): RedeemRow => ({
  account,
  childMarket_id: null,
  parentOutcomeIndex: BigInt(option),
  payout,
  transactionHash: "0xa1",
});

const childRow = (option: number, payout: bigint, account = TRADE_WALLET): RedeemRow => ({
  account,
  childMarket_id: childMarket(option).toLowerCase(),
  parentOutcomeIndex: BigInt(option),
  payout,
  transactionHash: "0xa1",
});

const settled = (cost: bigint, payout: bigint) => ({ status: "settled", cost, payout, pnl: payout - cost });

/**
 * Two options and INVALID; one prediction split 300 sDAI, so each option costs 150. In option 0 it minted 200
 * sets from its 300 parent tokens and sold the 200 DOWN for 60, keeping 160 parent tokens, 200 UP and 200 of the
 * child's INVALID.
 */
const TWO_OPTIONS = {
  account: TRADE_WALLET,
  splits: [{ transactionHash: "0xb1", amount: 300n }],
  holdings: { parent: [160n, 300n, 300n], children: { 0: [0n, 200n, 200n], 1: [0n, 0n, 0n] } },
  redeems: [],
} satisfies Omit<RealisedPnlInput, "resolution">;

describe("A4: realised P&L per option and per session, in sDAI", () => {
  it("is payout less cost for a winning option", () => {
    // parent picks option 0; its child pays UP 0.7: 160 parent tokens pay 160, 200 UP pay 140
    const result = realisedPnl({
      ...TWO_OPTIONS,
      resolution: {
        parent: parentResolved([1n, 0n, 0n], 1n),
        children: { 0: childResolved(0, [3n, 7n, 0n], 10n), 1: childOpen(1) },
      },
    });

    expect(result.options[0]).toEqual(settled(150n, 300n));
  });

  it("is minus its cost for a Not selected option, whose own market has not resolved", () => {
    const result = realisedPnl({
      ...TWO_OPTIONS,
      resolution: {
        parent: parentResolved([1n, 0n, 0n], 1n),
        children: { 0: childResolved(0, [3n, 7n, 0n], 10n), 1: childOpen(1) },
      },
    });

    expect(result.options[1]).toEqual(settled(150n, 0n));
    expect(result.options[1]).toMatchObject({ pnl: -150n });
    expect(result.session).toEqual({ cost: 300n, payout: 300n, pnl: 0n, waiting: [] });
  });

  it("is the INVALID payout less cost for an option whose market resolved INVALID", () => {
    // the child pays its INVALID token in full: 160 parent tokens pay 160, 200 child INVALID pay 200, UP pays 0
    const result = realisedPnl({
      ...TWO_OPTIONS,
      resolution: {
        parent: parentResolved([1n, 0n, 0n], 1n),
        children: { 0: childResolved(0, [0n, 0n, 1n], 1n), 1: childOpen(1) },
      },
    });

    expect(result.options[0]).toEqual(settled(150n, 360n));
    expect(result.session).toEqual({ cost: 300n, payout: 360n, pnl: 60n, waiting: [] });
  });

  it("charges each option an equal share of every split, whichever options the predictions traded", () => {
    const result = realisedPnl({
      ...TWO_OPTIONS,
      splits: [
        { transactionHash: "0xb1", amount: 300n },
        { transactionHash: "0xb2", amount: 100n },
      ],
      resolution: {
        parent: parentResolved([1n, 0n, 0n], 1n),
        children: { 0: childResolved(0, [3n, 7n, 0n], 10n), 1: childOpen(1) },
      },
    });

    expect(result.options[0]).toMatchObject({ cost: 200n });
    expect(result.options[1]).toMatchObject({ cost: 200n });
  });

  it("counts only the trade wallet's redeems, not the connected wallet's", () => {
    const resolution: SessionResolution = {
      parent: parentResolved([1n, 0n, 0n], 1n),
      children: { 0: childResolved(0, [3n, 7n, 0n], 10n), 1: childOpen(1) },
    };
    const alone = realisedPnl({ ...TWO_OPTIONS, resolution });
    const withOwner = realisedPnl({
      ...TWO_OPTIONS,
      resolution,
      redeems: [parentRow(0, 500n, OWNER), childRow(0, 70n, OWNER)],
    });

    expect(withOwner).toEqual(alone);
  });
});

describe("A5: the same figure before and after a redeem", () => {
  it("reads the indexed payouts after the redeem as it read the computed payout before", () => {
    const resolution: SessionResolution = {
      parent: parentResolved([1n, 0n, 0n], 1n),
      children: { 0: childResolved(0, [3n, 7n, 0n], 10n), 1: childOpen(1) },
    };
    const before = realisedPnl({ ...TWO_OPTIONS, resolution });
    // the redeem took the 160 parent tokens and the 200 UP; the child's INVALID pays nothing and stays
    const after = realisedPnl({
      ...TWO_OPTIONS,
      resolution,
      holdings: { parent: [0n, 300n, 300n], children: { 0: [0n, 0n, 200n], 1: [0n, 0n, 0n] } },
      redeems: [parentRow(0, 160n), childRow(0, 140n)],
    });

    expect(before.options[0]).toEqual(settled(150n, 300n));
    expect(after).toEqual(before);
  });

  it("reads the same per option and in total whichever parts were redeemed", () => {
    fc.assert(
      fc.property(session(), fc.infiniteStream(fc.boolean()), ({ input, payable }, redeemed) => {
        const before = realisedPnl(input);
        const after = realisedPnl(redeemSome(input, payable, () => redeemed.next().value as boolean));
        expect(after).toEqual(before);
      }),
      RUNS,
    );
  });
});

describe("options add up to the session", () => {
  it("sums each option's cost, payout and P&L into the session's, and charges the splits in full", () => {
    fc.assert(
      fc.property(session(), ({ input }) => {
        const result = realisedPnl(input);
        const options = Object.values(result.options);
        const total = (pick: (each: { cost: bigint; payout: bigint; pnl: bigint }) => bigint) =>
          options.reduce((sum, each) => sum + (each.status === "settled" ? pick(each) : 0n), 0n);

        expect(options).toHaveLength(input.holdings.parent.length - 1);
        expect(options.every((each) => each.status === "settled")).toBe(true);
        expect(result.session.cost).toBe(input.splits.reduce((sum, each) => sum + each.amount, 0n));
        expect(result.session).toEqual({
          cost: total((each) => each.cost),
          payout: total((each) => each.payout),
          pnl: total((each) => each.pnl),
          waiting: [],
        });
        expect(result.session.pnl).toBe(result.session.payout - result.session.cost);
      }),
      RUNS,
    );
  });
});

describe("A7: a session partly redeemed, partly waiting", () => {
  /**
   * Four options, 600 sDAI split, 150 each. The parent picks options 0, 1 and 2 at a third each. Option 0 was
   * redeemed for 100 (parent tokens) and 90 (child); option 1 resolved and holds 300 parent tokens (pay 100) and
   * 330 UP at 0.5 (165 parent tokens, pay 55); option 2's market has not resolved; option 3 lost.
   */
  const input: RealisedPnlInput = {
    account: TRADE_WALLET,
    resolution: {
      parent: parentResolved([1n, 1n, 1n, 0n, 0n], 3n),
      children: {
        0: childResolved(0, [5n, 5n, 0n], 10n),
        1: childResolved(1, [5n, 5n, 0n], 10n),
        2: childOpen(2),
        3: childOpen(3),
      },
    },
    splits: [{ transactionHash: "0xb1", amount: 600n }],
    holdings: {
      parent: [0n, 300n, 0n, 600n, 600n],
      children: { 0: [0n, 0n, 0n], 1: [0n, 330n, 0n], 2: [0n, 100n, 100n], 3: [0n, 0n, 0n] },
    },
    redeems: [parentRow(0, 100n), childRow(0, 90n)],
  };

  it("reads a redeemed option from its payouts and an unredeemed one from the computed payout", () => {
    const result = realisedPnl(input);

    expect(result.options[0]).toEqual(settled(150n, 190n));
    expect(result.options[1]).toEqual(settled(150n, 155n));
    expect(result.options[3]).toEqual(settled(150n, 0n));
  });

  it("reports an option still waiting for its result as waiting, not as zero", () => {
    const result = realisedPnl(input);

    expect(result.options[2]).toEqual({ status: "waiting", cost: 150n });
    expect(result.session.waiting).toEqual([2]);
  });
});

/** Oracle R5. */
const floorPay = (amount: bigint, numerator: bigint, denominator: bigint) => (amount * numerator) / denominator;

interface Generated {
  input: RealisedPnlInput;
  /** What each part pays now, per option: its parent tokens, and its child tokens through the parent. */
  payable: { parent: bigint; child: bigint }[];
}

/** A resolved session of one to four options, every child resolved, with the parent's INVALID paying nothing. */
function session(): fc.Arbitrary<Generated> {
  const amount = fc.bigInt({ min: 0n, max: 10n ** 24n });
  const numerator = fc.bigInt({ min: 0n, max: 10n });
  return fc
    .integer({ min: 1, max: 4 })
    .chain((count) =>
      fc.record({
        count: fc.constant(count),
        parentNumerators: fc
          .array(numerator, { minLength: count, maxLength: count })
          .filter((each) => each.some((value) => value > 0n)),
        children: fc.array(
          fc.record({
            numerators: fc.tuple(numerator, numerator, numerator).filter((each) => each.some((value) => value > 0n)),
            balances: fc.tuple(amount, amount, amount),
          }),
          { minLength: count, maxLength: count },
        ),
        parentBalances: fc.array(amount, { minLength: count + 1, maxLength: count + 1 }),
        splits: fc.array(fc.bigInt({ min: 0n, max: 10n ** 22n }), { minLength: 1, maxLength: 3 }),
      }),
    )
    .map(({ count, parentNumerators, children, parentBalances, splits }) => {
      const numerators = [...parentNumerators, 0n];
      const denominator = parentNumerators.reduce((sum, each) => sum + each, 0n);
      const payable = children.map((child, option) => {
        const childDenominator = child.numerators.reduce((sum, each) => sum + each, 0n);
        const pays = child.balances.reduce(
          (sum, balance, slot) => sum + floorPay(balance, child.numerators[slot]!, childDenominator),
          0n,
        );
        return {
          parent: floorPay(parentBalances[option]!, numerators[option]!, denominator),
          child: floorPay(pays, numerators[option]!, denominator),
        };
      });
      const input: RealisedPnlInput = {
        account: TRADE_WALLET,
        resolution: {
          parent: parentResolved(numerators, denominator),
          children: Object.fromEntries(
            children.map((child, option) => [
              option,
              childResolved(
                option,
                [...child.numerators],
                child.numerators.reduce((sum, each) => sum + each, 0n),
              ),
            ]),
          ),
        },
        // multiples of the option count, so an equal share needs no rounding rule
        splits: splits.map((each, index) => ({ transactionHash: `0xb${index}`, amount: each * BigInt(count) })),
        holdings: {
          parent: parentBalances,
          children: Object.fromEntries(children.map((child, option) => [option, [...child.balances]])),
        },
        redeems: [],
      };
      return { input, payable };
    });
}

/**
 * The same position after redeeming the parts `pick` chooses among those that pay (oracle R1): each redeemed
 * part's tokens leave the holdings and an indexed row carries the R5 payout.
 */
function redeemSome(input: RealisedPnlInput, payable: Generated["payable"], pick: () => boolean): RealisedPnlInput {
  const parent = [...input.holdings.parent];
  const children = { ...input.holdings.children };
  const redeems: RedeemRow[] = [];
  const resolution = input.resolution;
  payable.forEach((pays, option) => {
    if (pays.parent > 0n && pick()) {
      parent[option] = 0n;
      redeems.push(parentRow(option, pays.parent));
    }
    const child = resolution.children[option];
    if (pays.child > 0n && child?.deployed && child.resolved && pick()) {
      const { payoutNumerators, payoutDenominator } = child;
      // only the slots that pay at least 1 wei are redeemed; the rest stay held and pay nothing
      children[option] = children[option]!.map((balance, slot) =>
        floorPay(balance, payoutNumerators[slot]!, payoutDenominator) > 0n ? 0n : balance,
      );
      redeems.push(childRow(option, pays.child));
    }
  });
  return { ...input, holdings: { parent, children }, redeems };
}

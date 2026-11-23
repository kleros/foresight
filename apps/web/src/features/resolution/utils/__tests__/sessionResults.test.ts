import fc from "fast-check";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";

import type { ChildResolution, ParentResolution } from "../../api/getSessionResolution";
import { formatPayouts, optionResult, sessionResults } from "../sessionResults";

const MARKET = "0x00000000000000000000000000000000000000c1" as Address;
const option = {
  market: MARKET,
  name: "Gerwig",
  color: "#000",
  unit: "$M",
  lowerBound: 0,
  upperBound: 500,
  outcomeIndex: 1,
};
const ONE = 10n ** 18n;

type ResolvedParent = Extract<ParentResolution, { resolved: true }>;
const parent = (winners: number[], invalid = false): ResolvedParent => ({
  resolved: true,
  invalid,
  winningOutcomes: winners,
  payoutNumerators: invalid ? [0n, 0n, 0n, 1n] : [0, 1, 2].map((i) => (winners.includes(i) ? 1n : 0n)).concat(0n),
  payoutDenominator: invalid ? 1n : BigInt(winners.length),
});
const resolvedChild = (down: bigint, up: bigint): ChildResolution => ({
  deployed: true,
  market: MARKET,
  resolved: true,
  invalid: false,
  finalValue: (Number(up) / Number(down + up)) * 500,
  payoutNumerators: [down, up, 0n],
  payoutDenominator: down + up,
});
const invalidChild = (numerators: bigint[], denominator: bigint): ChildResolution => ({
  deployed: true,
  market: MARKET,
  resolved: true,
  invalid: true,
  finalValue: null,
  payoutNumerators: numerators,
  payoutDenominator: denominator,
});

describe("optionResult", () => {
  it("reads a resolved child as its final value, open-ended exactly where one side paid nothing", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 30n }), fc.bigInt({ min: 0n, max: 10n ** 30n }), (down, up) => {
        fc.pre(down + up > 0n);
        const result = optionResult(parent([1]), resolvedChild(down, up), option);
        if (result.kind !== "final") throw new Error(`expected final, got ${result.kind}`);
        expect(result.text.endsWith(" or more")).toBe(down === 0n);
        expect(result.text.endsWith(" or less")).toBe(up === 0n);
      }),
      {
        examples: [
          [0n, 1n],
          [1n, 0n],
          [1n, 1n],
        ],
      },
    );
  });

  it.each([
    { down: 0n, up: 7n, reads: "500 $M or more" },
    { down: 7n, up: 0n, reads: "0 $M or less" },
    { down: 3n, up: 1n, reads: "125 $M" },
  ])("reads DOWN $down and UP $up as $reads", ({ down, up, reads }) => {
    expect(optionResult(parent([1]), resolvedChild(down, up), option)).toMatchObject({ kind: "final", text: reads });
  });

  it.each([
    { down: 0n, up: 7n, reads: "0.005 or more" },
    { down: 7n, up: 0n, reads: "0.001 or less" },
    { down: 1n, up: 1n, reads: "0.00312" },
  ])("on a fractional scale reads DOWN $down and UP $up as $reads, not rounded away", ({ down, up, reads }) => {
    const fractional = { ...option, unit: null, lowerBound: 0.001, upperBound: 0.005 };
    const child = { ...resolvedChild(down, up), finalValue: 0.00312 };
    expect(optionResult(parent([1]), child, fractional)).toMatchObject({ kind: "final", text: reads });
  });

  it.each([
    { down: 0n, up: 7n, reads: "100.5 or more" },
    { down: 7n, up: 0n, reads: "0.001 or less" },
  ])("on a wide scale with a fine bound reads DOWN $down and UP $up as $reads", ({ down, up, reads }) => {
    const wide = { ...option, unit: null, lowerBound: 0.001, upperBound: 100.5 };
    expect(optionResult(parent([1]), resolvedChild(down, up), wide)).toMatchObject({ kind: "final", text: reads });
  });

  it.each([
    { finalValue: 0.0012, reads: "0.0012" },
    { finalValue: 100.4999, reads: "100.4999" },
    { finalValue: 50.25, reads: "50.25" },
  ])("on a wide scale with a fine bound reads $finalValue inside the bounds as $reads", ({ finalValue, reads }) => {
    const wide = { ...option, unit: null, lowerBound: 0.001, upperBound: 100.5 };
    const child = { ...resolvedChild(1n, 1n), finalValue };
    expect(optionResult(parent([1]), child, wide)).toMatchObject({ kind: "final", text: reads });
  });

  it("reads a final value on a scale whose range could not be read", () => {
    for (const [lowerBound, upperBound] of [
      [0, 0],
      [500, 0],
    ]) {
      const unread = { ...option, lowerBound: lowerBound!, upperBound: upperBound! };
      expect(optionResult(parent([1]), resolvedChild(1n, 1n), unread)).toMatchObject({ kind: "final", text: "250 $M" });
    }
  });

  it("reads an option the parent did not select as not selected, whatever its child holds", () => {
    for (const child of [resolvedChild(1n, 1n), invalidChild([0n, 0n, 1n], 1n), undefined, new Error("x")]) {
      expect(optionResult(parent([0, 2]), child, option)).toEqual({ kind: "not-selected" });
    }
  });

  it("reads every option as Invalid under an INVALID parent, with what its token pays", () => {
    for (const child of [resolvedChild(1n, 1n), { deployed: true, market: MARKET, resolved: false } as const]) {
      expect(optionResult(parent([], true), child, option)).toEqual({
        kind: "invalid",
        payouts: [{ token: "this option's token", pays: 0n }],
      });
    }
  });

  it("pays an INVALID child's tokens through the parent outcome's share", () => {
    expect(optionResult(parent([0, 1]), invalidChild([0n, 0n, 1n], 1n), option)).toEqual({
      kind: "invalid",
      payouts: [
        { token: "DOWN", pays: 0n },
        { token: "UP", pays: 0n },
        { token: "INVALID", pays: ONE / 2n },
      ],
    });
  });

  it("floors a child token's payout, then the parent outcome's share of it, in bigint", () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 0n, max: 10n ** 20n }), { minLength: 3, maxLength: 3 }),
        fc.bigInt({ min: 1n, max: 10n ** 20n }),
        fc.bigInt({ min: 0n, max: 10n ** 20n }),
        fc.bigInt({ min: 1n, max: 10n ** 20n }),
        (childNumerators, childDenominator, parentNumerator, parentDenominator) => {
          const winner: ResolvedParent = {
            resolved: true,
            invalid: false,
            winningOutcomes: [1],
            payoutNumerators: [0n, parentNumerator, 0n, 0n],
            payoutDenominator: parentDenominator,
          };
          const result = optionResult(winner, invalidChild(childNumerators, childDenominator), option);
          if (result.kind !== "invalid") throw new Error(`expected invalid, got ${result.kind}`);
          expect(result.payouts.map(({ pays }) => pays)).toEqual(
            childNumerators.map((n) => (((ONE * n) / childDenominator) * parentNumerator) / parentDenominator),
          );
        },
      ),
    );
  });

  it("waits only on a child read as unresolved; a child still being read is pending, a failed one unread", () => {
    const winner = parent([1]);
    expect(optionResult(winner, { deployed: true, market: MARKET, resolved: false }, option)).toEqual({
      kind: "waiting",
    });
    expect(optionResult(winner, undefined, option)).toEqual({ kind: "pending" });
    for (const child of [new Error("x"), { deployed: false } as const]) {
      expect(optionResult(winner, child, option)).toEqual({ kind: "unread" });
    }
  });
});

describe("sessionResults", () => {
  it("is undefined until the parent is read as resolved", () => {
    for (const read of [undefined, new Error("x"), { resolved: false } as const]) {
      expect(sessionResults(read, {}, [option])).toBeUndefined();
    }
  });

  it("states what the parent's INVALID token pays, and keys each option by lowercase market", () => {
    const results = sessionResults(parent([], true), new Error("x"), [
      { ...option, market: MARKET.toUpperCase() as Address },
    ]);
    expect(results?.invalid).toEqual([{ token: "the INVALID token", pays: ONE }]);
    expect(Object.keys(results!.options)).toEqual([MARKET.toLowerCase()]);
    expect(sessionResults(parent([1]), {}, [option])?.invalid).toBeNull();
  });
});

describe("sessionResults by outcome", () => {
  it("reads each option's child by its parent outcome index, not its place in the list", () => {
    const later = { ...option, market: "0x00000000000000000000000000000000000000c2" as Address, outcomeIndex: 2 };
    const earlier = { ...option, outcomeIndex: 0 };
    const results = sessionResults(
      parent([0, 2]),
      { 0: { deployed: true, market: MARKET, resolved: false }, 2: resolvedChild(3n, 1n) },
      [later, earlier],
    );
    expect(results?.options[later.market]).toMatchObject({ kind: "final", text: "125 $M" });
    expect(results?.options[earlier.market]).toEqual({ kind: "waiting" });
  });
});

describe("formatPayouts", () => {
  it("names each token's payout to four decimals, cut, with the symbol where there is one", () => {
    const payouts = [
      { token: "UP", pays: 123_456_789_000_000_000n },
      { token: "INVALID", pays: ONE },
      { token: "DOWN", pays: 0n },
    ];
    expect(formatPayouts(payouts, "sDAI")).toBe("UP pays 0.1234 sDAI, INVALID pays 1 sDAI, DOWN pays 0 sDAI");
    expect(formatPayouts(payouts, null)).toBe("UP pays 0.1234, INVALID pays 1, DOWN pays 0");
  });
});

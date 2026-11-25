import type { Address } from "viem";
import { describe, expect, it } from "vitest";

import type { ChildResolution, ParentResolution } from "../../api/getSessionResolution";
import { finalValueText, sessionResults, type ResultOption } from "../sessionResults";

const market = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;

const option = (outcomeIndex: number, overrides: Partial<ResultOption> = {}): ResultOption => ({
  market: market(outcomeIndex + 1),
  outcomeIndex,
  name: `Option ${outcomeIndex}`,
  color: "#000",
  unit: "$M",
  lowerBound: 0,
  upperBound: 500,
  ...overrides,
});

const OPTIONS = [option(0), option(1), option(2)];

const parent = (winningOutcomes: number[]): ParentResolution => ({
  resolved: true,
  invalid: false,
  winningOutcomes,
  payoutNumerators: [...OPTIONS.map(({ outcomeIndex }) => (winningOutcomes.includes(outcomeIndex) ? 1n : 0n)), 0n],
  payoutDenominator: BigInt(winningOutcomes.length),
});

const resolved = (address: Address, finalValue: number, down: bigint, up: bigint): ChildResolution => ({
  deployed: true,
  market: address,
  resolved: true,
  invalid: false,
  finalValue,
  payoutNumerators: [down, up, 0n],
  payoutDenominator: down + up,
});

describe("sessionResults", () => {
  it("is undefined until the parent resolves, or while its read fails", () => {
    expect(sessionResults(undefined, {}, OPTIONS)).toBeUndefined();
    expect(sessionResults({ resolved: false }, {}, OPTIONS)).toBeUndefined();
    expect(sessionResults(new Error("read failed"), {}, OPTIONS)).toBeUndefined();
  });

  it("splits winners from losers, and a winner's state from its own child's read", () => {
    const children = {
      0: resolved(market(1), 125, 3n, 1n),
      1: { deployed: true, market: market(2), resolved: false } as const,
    };

    const results = sessionResults(parent([0, 1]), children, OPTIONS)!;

    expect(results.winners.map(({ name }) => name)).toEqual(["Option 0", "Option 1"]);
    expect(results.options[market(1)]).toEqual({ kind: "final", text: "125 $M", share: 0.25 });
    expect(results.options[market(2)]).toEqual({ kind: "waiting" });
    expect(results.options[market(3)]).toEqual({ kind: "not-selected" });
  });

  it("holds a winner as loading while the children are unread, and unread where their read failed", () => {
    expect(sessionResults(parent([0]), undefined, OPTIONS)!.options[market(1)]).toEqual({ kind: "loading" });
    expect(sessionResults(parent([0]), new Error("read failed"), OPTIONS)!.options[market(1)]).toEqual({
      kind: "unread",
    });
  });

  it("does not take a child read for another market as this option's answer", () => {
    const children = { 0: resolved(market(9), 125, 3n, 1n) };

    expect(sessionResults(parent([0]), children, OPTIONS)!.options[market(1)]).toEqual({ kind: "unread" });
  });

  it("reads an INVALID child as invalid, with what each of its tokens pays", () => {
    const children: Record<number, ChildResolution> = {
      0: {
        deployed: true,
        market: market(1),
        resolved: true,
        invalid: true,
        finalValue: null,
        payoutNumerators: [0n, 0n, 1n],
        payoutDenominator: 1n,
      },
    };

    expect(sessionResults(parent([0]), children, OPTIONS)!.options[market(1)]).toEqual({
      kind: "invalid",
      payouts: "Pays per token: UP 0, DOWN 0, INVALID 1",
    });
  });

  it("reads an INVALID parent as invalid, with no winner, and says what each parent token pays", () => {
    const invalid: ParentResolution = {
      resolved: true,
      invalid: true,
      winningOutcomes: [],
      payoutNumerators: [0n, 0n, 0n, 1n],
      payoutDenominator: 1n,
    };

    const results = sessionResults(invalid, { 0: resolved(market(1), 125, 3n, 1n) }, OPTIONS)!;

    expect(results.invalidPayouts).toBe("Pays per token: each option 0, INVALID 1");
    expect(results.winners).toEqual([]);
    expect(Object.values(results.options)).toEqual(OPTIONS.map(() => ({ kind: "invalid" })));
  });

  it("names each option's payout where an INVALID parent pays options unequally", () => {
    const invalid: ParentResolution = {
      resolved: true,
      invalid: true,
      winningOutcomes: [0],
      payoutNumerators: [1n, 0n, 0n, 1n],
      payoutDenominator: 2n,
    };

    expect(sessionResults(invalid, {}, OPTIONS)!.invalidPayouts).toBe(
      "Pays per token: Option 0 0.5, Option 1 0, Option 2 0, INVALID 0.5",
    );
  });
});

describe("finalValueText", () => {
  const scale = { lowerBound: 0, upperBound: 500, unit: "$M" };

  it("reads a payout all to UP as the upper bound or more, and all to DOWN as the lower bound or less", () => {
    expect(finalValueText(500, [0n, 1n], scale)).toBe("500 $M or more");
    expect(finalValueText(0, [1n, 0n], scale)).toBe("0 $M or less");
  });

  it("reads a value inside the bounds as the value", () => {
    expect(finalValueText(312.5, [3n, 5n], scale)).toBe("312.5 $M");
  });

  it("keeps a small value inside wide bounds from rounding onto the lower bound", () => {
    const fractional = { lowerBound: 0.001, upperBound: 100.5, unit: null };

    expect(finalValueText(0.0012, [1n, 1n], fractional)).toBe("0.0012");
  });

  it("keeps a value just under the upper bound from rounding onto it", () => {
    expect(finalValueText(499.999, [1n, 999n], scale)).toBe("499.999 $M");
  });

  it("writes a fractional bound with every place it was set with", () => {
    const fractional = { lowerBound: 0.001, upperBound: 100.5, unit: null };

    expect(finalValueText(0.001, [1n, 0n], fractional)).toBe("0.001 or less");
    expect(finalValueText(100.5, [0n, 1n], fractional)).toBe("100.5 or more");
  });
});

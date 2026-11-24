import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { SessionResolution } from "../../api/getSessionResolution";
import { realisedPnl, splitDeposits, type RealisedPnlInput, type RedeemRow, type RouterTransfer } from "../realisedPnl";

const RUNS = { seed: 20261124, numRuns: 200 } as const;
const WALLET = "0x00000000000000000000000000000000000000e1";
const SDAI = "0x000000000000000000000000000000000000ada1";
const PARENT_TOKENS = ["0x0000000000000000000000000000000000005da1", "0x0000000000000000000000000000000000005da2"];
const OTHER_SESSION_TOKEN = "0x0000000000000000000000000000000000007777";

const unresolvedChildren: SessionResolution["children"] = {
  0: { deployed: true, market: "0x0000000000000000000000000000000000000c00", resolved: false },
  1: { deployed: true, market: "0x0000000000000000000000000000000000000c01", resolved: false },
};

const base = (resolution: SessionResolution, splits: bigint[]): RealisedPnlInput => ({
  account: WALLET,
  resolution,
  splits: splits.map((amount, index) => ({ transactionHash: `0xb${index}`, amount })),
  holdings: { parent: [100n, 100n, 100n], children: { 0: [0n, 0n, 0n], 1: [0n, 0n, 0n] } },
  redeems: [],
});

describe("realisedPnl beyond the acceptance cases", () => {
  it("reports every option waiting while the parent has not resolved", () => {
    const result = realisedPnl(base({ parent: { resolved: false }, children: unresolvedChildren }, [200n]));

    expect(result.options).toEqual({ 0: { status: "waiting", cost: 100n }, 1: { status: "waiting", cost: 100n } });
    expect(result.session).toEqual({ cost: 0n, payout: 0n, pnl: 0n, waiting: [0, 1] });
  });

  it("shares the parent's INVALID payout evenly over the options, held and redeemed alike", () => {
    const resolution: SessionResolution = {
      parent: {
        resolved: true,
        invalid: true,
        winningOutcomes: [],
        payoutNumerators: [0n, 0n, 1n],
        payoutDenominator: 1n,
      },
      children: unresolvedChildren,
    };
    const held = realisedPnl(base(resolution, [100n]));
    const redeemed = realisedPnl({
      ...base(resolution, [100n]),
      holdings: { parent: [100n, 100n, 0n], children: { 0: [0n, 0n, 0n], 1: [0n, 0n, 0n] } },
      redeems: [
        { account: WALLET, childMarket_id: null, parentOutcomeIndex: 2n, payout: 100n, transactionHash: "0xa1" },
      ],
    });

    expect(held.options[0]).toEqual({ status: "settled", cost: 50n, payout: 50n, pnl: 0n });
    expect(held.session).toEqual({ cost: 100n, payout: 100n, pnl: 0n, waiting: [] });
    expect(redeemed).toEqual(held);
  });

  it("keeps an uneven split's options adding up to the deposit and the payout", () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: -(10n ** 21n), max: 10n ** 21n }), { minLength: 1, maxLength: 4 }),
        fc.bigInt({ min: 0n, max: 10n ** 21n }),
        (splits, invalidHeld) => {
          const resolution: SessionResolution = {
            parent: {
              resolved: true,
              invalid: true,
              winningOutcomes: [],
              payoutNumerators: [0n, 0n, 0n, 3n],
              payoutDenominator: 7n,
            },
            children: {},
          };
          const result = realisedPnl({
            account: WALLET,
            resolution,
            splits: splits.map((amount, index) => ({ transactionHash: `0xb${index}`, amount })),
            holdings: { parent: [0n, 0n, 0n, invalidHeld], children: {} },
            redeems: [],
          });
          const options = Object.values(result.options).flatMap((each) => (each.status === "settled" ? [each] : []));

          expect(options).toHaveLength(3);
          expect(result.session.cost).toBe(splits.reduce((sum, each) => sum + each, 0n));
          expect(result.session.payout).toBe((invalidHeld * 3n) / 7n);
          expect(options.reduce((sum, each) => sum + each.cost, 0n)).toBe(result.session.cost);
          expect(options.reduce((sum, each) => sum + each.payout, 0n)).toBe(result.session.payout);
        },
      ),
      RUNS,
    );
  });
});

describe("splitDeposits", () => {
  const scope = { collateral: SDAI, parentTokens: PARENT_TOKENS };
  const row = (transactionHash: string, payout: bigint, childMarket_id: string | null = null): RedeemRow => ({
    account: WALLET,
    childMarket_id,
    parentOutcomeIndex: 0n,
    payout,
    transactionHash,
  });

  it("nets splits less merges, and a parent redeem's payout to nothing", () => {
    const amount = fc.bigInt({ min: 1n, max: 10n ** 24n });
    fc.assert(
      fc.property(
        fc.array(fc.record({ kind: fc.constantFrom("split", "merge", "redeem", "mint", "other"), amount }), {
          maxLength: 8,
        }),
        (flows) => {
          const transfers: RouterTransfer[] = [];
          const redeems: RedeemRow[] = [];
          flows.forEach(({ kind, amount }, index) => {
            const hash = `0x${index}`;
            const parentToken = PARENT_TOKENS[index % PARENT_TOKENS.length]!;
            if (kind === "split") {
              transfers.push({ transactionHash: hash, token: SDAI, amount: -amount });
              transfers.push({ transactionHash: hash, token: parentToken, amount });
            } else if (kind === "merge") {
              transfers.push({ transactionHash: hash, token: parentToken, amount: -amount });
              transfers.push({ transactionHash: hash, token: SDAI, amount });
            } else if (kind === "redeem") {
              transfers.push({ transactionHash: hash, token: parentToken, amount: -amount });
              transfers.push({ transactionHash: hash, token: SDAI, amount });
              redeems.push(row(hash, amount));
            } else if (kind === "mint") {
              transfers.push({ transactionHash: hash, token: parentToken, amount: -amount });
            } else {
              transfers.push({ transactionHash: hash, token: SDAI, amount: -amount });
              transfers.push({ transactionHash: hash, token: OTHER_SESSION_TOKEN, amount });
            }
          });

          const total = splitDeposits(transfers, redeems, scope).reduce((sum, each) => sum + each.amount, 0n);
          const expected = flows.reduce(
            (sum, { kind, amount }) => (kind === "split" ? sum + amount : kind === "merge" ? sum - amount : sum),
            0n,
          );
          expect(total).toBe(expected);
        },
      ),
      RUNS,
    );
  });

  it("does not add a child redeem's payout back, which the conditional router paid", () => {
    const transfers: RouterTransfer[] = [
      { transactionHash: "0xa1", token: PARENT_TOKENS[0]!, amount: -40n },
      { transactionHash: "0xa1", token: SDAI, amount: 40n },
    ];

    expect(splitDeposits(transfers, [row("0xa1", 40n), row("0xa1", 9n, "0xc00")], scope)).toEqual([
      { transactionHash: "0xa1", amount: 0n },
    ]);
  });
});

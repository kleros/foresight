import { describe, expect, it } from "vitest";

import type { ChildResolution, SessionResolution } from "../../api/getSessionResolution";
import { realisedPnl, type RealisedPnlInput } from "../realisedPnl";

const TRADE_WALLET = "0x00000000000000000000000000000000000000e1";

const resolvedParent = (payoutNumerators: bigint[], payoutDenominator: bigint): SessionResolution["parent"] => ({
  resolved: true,
  invalid: payoutNumerators.at(-1)! > 0n,
  winningOutcomes: payoutNumerators.slice(0, -1).flatMap((each, index) => (each > 0n ? [index] : [])),
  payoutNumerators,
  payoutDenominator,
});

const base = (resolution: SessionResolution, parent: bigint[]): RealisedPnlInput => ({
  account: TRADE_WALLET,
  resolution,
  splits: [{ transactionHash: "0xb1", amount: 300n }],
  holdings: { parent, children: {} },
  redeems: [],
});

describe("realisedPnl", () => {
  it("settles a winning option whose child was never deployed from its parent tokens", () => {
    const input = base(
      { parent: resolvedParent([1n, 0n, 0n], 1n), children: { 0: { deployed: false }, 1: { deployed: false } } },
      [300n, 300n, 300n],
    );
    // balances of a child that does not exist pay nothing and keep nothing waiting
    const result = realisedPnl({ ...input, holdings: { ...input.holdings, children: { 0: [0n, 50n, 0n] } } });

    expect(result.options[0]).toEqual({ status: "settled", cost: 150n, payout: 300n, pnl: 150n });
    expect(result.session.waiting).toEqual([]);
  });

  it("shares the parent INVALID token's payout between the options as it shares the cost", () => {
    const resolution = { parent: resolvedParent([0n, 0n, 1n], 1n), children: {} };
    const held = realisedPnl(base(resolution, [300n, 300n, 301n]));
    const redeemed = realisedPnl({
      ...base(resolution, [300n, 300n, 0n]),
      redeems: [
        { account: TRADE_WALLET, childMarket_id: null, parentOutcomeIndex: 2n, payout: 301n, transactionHash: "0xa1" },
      ],
    });

    expect(held.options).toEqual({
      0: { status: "settled", cost: 150n, payout: 151n, pnl: 1n },
      1: { status: "settled", cost: 150n, payout: 150n, pnl: 0n },
    });
    expect(redeemed).toEqual(held);
  });

  it("charges an uneven split in full, the first options taking the remainder", () => {
    const result = realisedPnl({
      ...base({ parent: resolvedParent([0n, 0n, 0n, 1n], 1n), children: {} }, [0n, 0n, 0n, 0n]),
      splits: [{ transactionHash: "0xb1", amount: 301n }],
    });

    expect(Object.values(result.options).map((each) => each.cost)).toEqual([101n, 100n, 100n]);
    expect(result.session.cost).toBe(301n);
  });

  it("reads every option as waiting until the parent resolves", () => {
    const result = realisedPnl(base({ parent: { resolved: false }, children: {} }, [300n, 300n, 300n]));

    expect(result.options).toEqual({ 0: { status: "waiting", cost: 150n }, 1: { status: "waiting", cost: 150n } });
    expect(result.session).toEqual({ cost: 0n, payout: 0n, pnl: 0n, waiting: [0, 1] });
  });

  it("matches the trade wallet's redeems whatever the address case", () => {
    const resolution = { parent: resolvedParent([1n, 0n, 0n], 1n), children: {} };
    const result = realisedPnl({
      ...base(resolution, [0n, 300n, 300n]),
      account: TRADE_WALLET.toUpperCase().replace("0X", "0x"),
      redeems: [
        { account: TRADE_WALLET, childMarket_id: null, parentOutcomeIndex: 0n, payout: 300n, transactionHash: "0xa1" },
      ],
    });

    expect(result.options[0]).toMatchObject({ payout: 300n });
  });

  // option 0 holds 100 parent tokens and, when held, 50 UP of its child; UP pays 0.7 once the child resolves
  const CHILD_RESOLVED: ChildResolution = {
    deployed: true,
    market: "0x00000000000000000000000000000000000000c0",
    resolved: true,
    invalid: false,
    finalValue: 70,
    payoutNumerators: [3n, 7n, 0n],
    payoutDenominator: 10n,
  };
  const childOf = (deployed: boolean, resolved: boolean): ChildResolution =>
    !deployed
      ? { deployed: false }
      : resolved
        ? CHILD_RESOLVED
        : { deployed: true, market: CHILD_RESOLVED.market, resolved: false };
  const waiting = { status: "waiting", cost: 150n } as const;
  const settled = (payout: bigint) => ({ status: "settled", cost: 150n, payout, pnl: payout - 150n }) as const;

  // [paying, child deployed, child resolved, child tokens held]; an undeployed child has no resolution to read
  it.for([
    [true, true, false, true, waiting],
    [true, true, false, false, settled(100n)],
    [true, true, true, true, settled(135n)],
    [true, true, true, false, settled(100n)],
    [true, false, false, true, settled(100n)],
    [true, false, false, false, settled(100n)],
    [true, false, true, true, settled(100n)],
    [true, false, true, false, settled(100n)],
    [false, true, false, true, settled(0n)],
    [false, true, false, false, settled(0n)],
    [false, true, true, true, settled(0n)],
    [false, true, true, false, settled(0n)],
    [false, false, false, true, settled(0n)],
    [false, false, false, false, settled(0n)],
    [false, false, true, true, settled(0n)],
    [false, false, true, false, settled(0n)],
  ] as const)(
    "reads an option paying %s, child deployed %s, resolved %s, tokens held %s as %o",
    ([paying, deployed, resolved, held, expected]) => {
      const result = realisedPnl({
        ...base(
          {
            parent: resolvedParent(paying ? [1n, 0n, 0n] : [0n, 1n, 0n], 1n),
            children: { 0: childOf(deployed, resolved), 1: { deployed: false } },
          },
          [100n, 0n, 0n],
        ),
        holdings: { parent: [100n, 0n, 0n], children: { 0: held ? [0n, 50n, 0n] : [0n, 0n, 0n] } },
      });

      expect(result.options[0]).toEqual(expected);
      expect(result.session.waiting).toEqual(expected.status === "waiting" ? [0] : []);
    },
  );
});

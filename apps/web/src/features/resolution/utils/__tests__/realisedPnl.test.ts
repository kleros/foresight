import { describe, expect, it } from "vitest";

import type { SessionResolution } from "../../api/getSessionResolution";
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
    const result = realisedPnl(
      base({ parent: resolvedParent([1n, 0n, 0n], 1n), children: { 0: { deployed: false }, 1: { deployed: false } } }, [
        300n,
        300n,
        300n,
      ]),
    );

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
});

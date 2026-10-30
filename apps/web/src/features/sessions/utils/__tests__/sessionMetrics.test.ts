import fc from "fast-check";
import { parseEther, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { addresses, GATEWAY } from "@/testing/fixtures";

import type { PoolBalances, PoolSide, SessionPool, SessionStats } from "../../types";
import { sessionMetrics } from "../sessionMetrics";
import { toSessionDetail } from "../toSessionDetail";
import { sessionChildRow, sessionDetailColumns } from "./fixtures";

const [MARKET_A, MARKET_B] = [addresses.childMarkets[0]!, addresses.childMarkets[1]!];

// two options, outcomeCount 2: one underlying is half a unit of collateral
const session = toSessionDetail(
  {
    ...sessionDetailColumns,
    children: [
      sessionChildRow({ id: MARKET_A, parentOutcomeIndex: "0", displayName: "Option A" }),
      sessionChildRow({ id: MARKET_B, parentOutcomeIndex: "1", displayName: "Option B" }),
    ],
  },
  GATEWAY,
);

let next = 0;
function pool(
  market: Address,
  side: PoolSide,
  { volume = "0", notional = "0", price = null as string | null } = {},
): SessionPool {
  next += 1;
  return {
    id: `0x${String(next).padStart(40, "0")}`,
    market: market.toLowerCase() as Address,
    side,
    outcomeToken: `0x${String(next).padStart(40, "a")}`,
    underlyingToken: `0x${String(next).padStart(40, "b")}`,
    underlyingPerOutcome: price === null ? null : parseEther(price),
    volumeUnderlying: parseEther(volume),
    volumeOutcome: parseEther(notional),
  };
}

const statsOf = (pools: SessionPool[]): SessionStats => ({
  traders: 1,
  volumeUnderlying: pools.reduce((sum, each) => sum + each.volumeUnderlying, 0n),
  volumeOutcome: pools.reduce((sum, each) => sum + each.volumeOutcome, 0n),
  pools,
});

const held = (outcome: string, underlying: string) => ({
  outcome: parseEther(outcome),
  underlying: parseEther(underlying),
});

describe("sessionMetrics, notional volume", () => {
  it("sums every pool's outcome-token leg at one underlying a token, in collateral", () => {
    const pools = [
      pool(MARKET_A, "UP", { volume: "20", notional: "30" }),
      pool(MARKET_A, "DOWN", { volume: "8", notional: "12" }),
      pool(MARKET_B, "UP", { volume: "5", notional: "9" }),
      pool(MARKET_B, "DOWN", { volume: "3", notional: "3" }),
    ];

    const metrics = sessionMetrics(session, statsOf(pools), undefined)!;

    // (30 + 12 + 9 + 3) / 2 outcomes
    expect(metrics.notional).toBe(27);
    // (20 + 8 + 5 + 3) / 2
    expect(metrics.volume).toBe(18);
    expect(metrics.options.map((option) => [option.name, option.notional])).toEqual([
      ["Option A", 21],
      ["Option B", 6],
    ]);
    expect(metrics.options[0]!.pools.map((each) => [each.side, each.notional])).toEqual([
      ["UP", 15],
      ["DOWN", 6],
    ]);
  });
});

describe("sessionMetrics, liquidity", () => {
  it("values a priced pool's outcome tokens at its price and an unpriced pool's at nothing", () => {
    const priced = pool(MARKET_A, "UP", { price: "0.6" });
    const unpriced = pool(MARKET_A, "DOWN");
    const balances: PoolBalances = { [priced.id]: held("10", "3"), [unpriced.id]: held("50", "2") };

    const metrics = sessionMetrics(session, statsOf([priced, unpriced]), balances)!;

    // priced: 10 × 0.6 + 3 = 9; unpriced: 2 only; (9 + 2) / 2 outcomes
    expect(metrics.liquidity).toBe(5.5);
    expect(metrics.options[0]!.pools).toEqual([
      expect.objectContaining({ side: "UP", liquidity: { ...held("10", "3"), priced: true, value: 4.5 } }),
      expect.objectContaining({ side: "DOWN", liquidity: { ...held("50", "2"), priced: false, value: 1 } }),
    ]);
  });

  it("has no liquidity until every pool's balances are read", () => {
    const up = pool(MARKET_A, "UP", { price: "0.5" });
    const down = pool(MARKET_A, "DOWN", { price: "0.5" });

    expect(sessionMetrics(session, statsOf([up, down]), undefined)!.liquidity).toBeNull();
    expect(sessionMetrics(session, statsOf([up, down]), { [up.id]: held("1", "1") })!.liquidity).toBeNull();
  });

  it("counts an unpriced pool as one priced at zero, whatever it holds", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 30n }), fc.bigInt({ min: 0n, max: 10n ** 30n }), (out, under) => {
        const unpriced = pool(MARKET_B, "UP");
        const atZero = { ...unpriced, underlyingPerOutcome: 0n };
        const balances = { [unpriced.id]: { outcome: out, underlying: under } };

        expect(sessionMetrics(session, statsOf([unpriced]), balances)!.liquidity).toBe(
          sessionMetrics(session, statsOf([atZero]), balances)!.liquidity,
        );
      }),
    );
  });

  it("gives the same totals whatever order the indexer serves the pools in", () => {
    const pools = [
      pool(MARKET_A, "UP", { volume: "1.5", notional: "2", price: "0.3" }),
      pool(MARKET_A, "DOWN", { volume: "4", notional: "7", price: "0.7" }),
      pool(MARKET_B, "UP", { volume: "2.25", notional: "3" }),
      pool(MARKET_B, "DOWN", { volume: "0.5", notional: "1", price: "0.45" }),
    ];
    const balances = Object.fromEntries(pools.map((each, index) => [each.id, held(String(index + 1), "1.25")]));
    const expected = sessionMetrics(session, statsOf(pools), balances);

    fc.assert(
      fc.property(fc.shuffledSubarray(pools, { minLength: pools.length }), (shuffled) => {
        expect(sessionMetrics(session, statsOf(shuffled), balances)).toEqual(expected);
      }),
    );
  });

  it("reports nothing for a session without outcomes", () => {
    const empty = toSessionDetail({ ...sessionDetailColumns, outcomeCount: "0", children: [] }, GATEWAY);

    expect(sessionMetrics(empty, statsOf([]), {})).toBeNull();
  });
});

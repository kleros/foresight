import { describe, expect, it } from "vitest";

import type { SessionChartQuery } from "@/lib/graphql/generated/graphql";

import { addresses, dune } from "@/testing/fixtures";

import type { SessionOption } from "../../types";
import { toSessionChart } from "../toSessionChart";

const pools = {
  up: "0x1111111111111111111111111111111111111111",
  other: "0x2222222222222222222222222222222222222222",
} as const;

// Indexer prices: underlying per whole outcome token, 1e18-scaled.
const WAD = { "0.25": "250000000000000000", "4": "4000000000000000000" } as const;

function option(overrides: Partial<SessionOption> = {}): SessionOption {
  return {
    market: addresses.childMarkets[0],
    outcomeIndex: 1,
    name: dune.director.displayName,
    color: dune.director.color,
    question: "Opening weekend gross if Gerwig directs",
    unit: dune.unit,
    lowerBound: 0,
    upperBound: 500,
    upToken: addresses.upToken,
    downToken: addresses.downToken,
    underlyingToken: addresses.underlyingToken,
    underlyingDecimals: 18,
    underlyingSymbol: "sDAI",
    blocks: [],
    ...overrides,
  };
}

function swapRow(overrides: Partial<SessionChartQuery["Pool"][number]["swaps"][number]> = {}) {
  return {
    underlyingPerOutcomeAfter: WAD["0.25"],
    timestamp: "1756000100",
    ...overrides,
  } satisfies SessionChartQuery["Pool"][number]["swaps"][number];
}

function poolRow(overrides: Partial<SessionChartQuery["Pool"][number]> = {}) {
  return {
    id: pools.up,
    childMarket_id: addresses.childMarkets[0],
    underlyingPerOutcome: WAD["0.25"],
    updatedAt: "1756000100",
    swaps: [],
    ...overrides,
  } satisfies SessionChartQuery["Pool"][number];
}

describe("toSessionChart", () => {
  it("prices a swap as an estimate on the option's own scale", () => {
    const result = { Pool: [poolRow({ swaps: [swapRow()] })] };

    // a price of 0.25 on a 0..500 scale
    expect(toSessionChart(result, [option()])[0]?.points).toEqual([{ timestamp: 1756000100, value: 125 }]);
  });

  it("starts the scale at the option's lower bound", () => {
    const result = { Pool: [poolRow()] };

    // 100 + 1/4 of the 100..500 span
    expect(toSessionChart(result, [option({ lowerBound: 100 })])[0]?.points).toEqual([
      { timestamp: 1756000100, value: 200 },
    ]);
  });

  it("keeps each option's pool on its own series, in the options' order", () => {
    const result = {
      Pool: [
        poolRow({
          id: pools.other,
          childMarket_id: addresses.childMarkets[1],
          underlyingPerOutcome: WAD["4"],
          swaps: [swapRow({ underlyingPerOutcomeAfter: WAD["4"] })],
        }),
        poolRow({ swaps: [swapRow()] }),
      ],
    };
    const villeneuve = option({ market: addresses.childMarkets[1], name: "Villeneuve" });

    const data = toSessionChart(result, [option(), villeneuve]);

    expect(data.map(({ option: { name }, points }) => [name, points[0]?.value])).toEqual([
      [dune.director.displayName, 125],
      ["Villeneuve", 2000],
    ]);
  });

  it("charts a pool that initialised but never traded at its seeded price", () => {
    const result = { Pool: [poolRow({ updatedAt: "1756000000" })] };

    expect(toSessionChart(result, [option()])[0]?.points).toEqual([{ timestamp: 1756000000, value: 125 }]);
  });

  it("does not repeat the last swap as a current point", () => {
    const result = { Pool: [poolRow({ updatedAt: "1756000100", swaps: [swapRow({ timestamp: "1756000100" })] })] };

    expect(toSessionChart(result, [option()])[0]?.points).toHaveLength(1);
  });

  it("keeps an option whose pool never priced, as a series with no points", () => {
    const result = { Pool: [poolRow({ underlyingPerOutcome: null })] };

    expect(toSessionChart(result, [option()])[0]?.points).toEqual([]);
  });

  it("keeps an option with no pool at all, as a series with no points", () => {
    const result = { Pool: [] };

    expect(toSessionChart(result, [option()])[0]?.points).toEqual([]);
  });

  it("joins pools to options whatever the address casing", () => {
    const checksummed = addresses.childMarkets[0].replace("0xc", "0xC") as SessionOption["market"];
    const result = { Pool: [poolRow()] };

    expect(toSessionChart(result, [option({ market: checksummed })])).toHaveLength(1);
  });

  it("carries the option's identity and scale for the chart to draw with", () => {
    const result = { Pool: [poolRow()] };

    expect(toSessionChart(result, [option()])[0]?.option).toEqual({
      market: addresses.childMarkets[0],
      name: dune.director.displayName,
      color: dune.director.color,
      unit: dune.unit,
      lowerBound: 0,
      upperBound: 500,
    });
  });
});

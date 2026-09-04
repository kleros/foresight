import { describe, expect, it } from "vitest";

import { addresses, dune } from "@/testing/fixtures";

import type { SessionChartSeries } from "../../types";
import { buildChartSeries, chartTimestamps, GRID_STEP_SECONDS } from "../chartSeries";

const S = GRID_STEP_SECONDS;

function series(
  points: SessionChartSeries["points"],
  bounds: { lowerBound: number; upperBound: number } = { lowerBound: 0, upperBound: 500 },
): SessionChartSeries {
  return {
    option: {
      market: addresses.childMarkets[0],
      name: dune.director.displayName,
      color: dune.director.color,
      unit: dune.unit,
      ...bounds,
    },
    points,
  };
}

const values = (built: ReturnType<typeof buildChartSeries>) => built[0]?.points.map(({ value }) => value);

describe("chartTimestamps", () => {
  it("steps from first to last on the grid", () => {
    expect(chartTimestamps(0, 2 * S)).toEqual([0, S, 2 * S]);
  });

  it("always ends on the exact last timestamp", () => {
    expect(chartTimestamps(0, 2.5 * S)).toEqual([0, S, 2 * S, 2.5 * S]);
  });

  it("is empty when the range is inverted", () => {
    expect(chartTimestamps(S, 0)).toEqual([]);
  });
});

describe("buildChartSeries", () => {
  it("carries the last value forward until the next trade", () => {
    // the 125 seed is dropped; the grid reads the surviving trades
    const points = [
      { timestamp: 0, value: 125 },
      { timestamp: 0, value: 100 },
      { timestamp: 2 * S, value: 300 },
    ];

    expect(values(buildChartSeries([series(points)], 0, 3 * S))).toEqual([100, 100, 300, 300]);
  });

  it("carries the earliest value back to grid times before it", () => {
    const points = [
      { timestamp: 0, value: 125 },
      { timestamp: 2 * S, value: 300 },
    ];

    expect(values(buildChartSeries([series(points)], 0, 2 * S))).toEqual([300, 300, 300]);
  });

  it("drops the seeded first price once a trade follows", () => {
    const points = [
      { timestamp: 0, value: 125 },
      { timestamp: S, value: 200 },
    ];

    expect(values(buildChartSeries([series(points)], 0, S))).toEqual([200, 200]);
  });

  it("keeps a lone seeded price", () => {
    expect(values(buildChartSeries([series([{ timestamp: 0, value: 125 }])], 0, S))).toEqual([125, 125]);
  });

  it("skips leading values pinned to a bound", () => {
    const points = [
      { timestamp: 0, value: 500 },
      { timestamp: S, value: 0.2 },
      { timestamp: 2 * S, value: 125 },
    ];

    expect(values(buildChartSeries([series(points)], 0, 2 * S))).toEqual([125, 125, 125]);
  });

  it("skips values still pinned to the top of the scale", () => {
    const points = [
      { timestamp: 0, value: 125 },
      { timestamp: S, value: 500 },
      { timestamp: 2 * S, value: 300 },
    ];

    expect(values(buildChartSeries([series(points)], 0, 2 * S))).toEqual([300, 300, 300]);
  });

  it("draws a series with no points flat at the lower bound", () => {
    const empty = series([], { lowerBound: 100, upperBound: 500 });

    expect(values(buildChartSeries([empty], 0, S))).toEqual([100, 100]);
  });
});

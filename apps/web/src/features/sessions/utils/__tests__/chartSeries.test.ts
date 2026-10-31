import { describe, expect, it } from "vitest";

import { addresses, dune } from "@/testing/fixtures";

import type { SessionChartSeries } from "../../types";
import { buildChartSeries, chartEndTime, chartTimestamps, GRID_STEP_SECONDS } from "../chartSeries";

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

describe("chartEndTime", () => {
  const traded = (...timestamps: number[]) => [series(timestamps.map((timestamp) => ({ timestamp, value: 100 })))];

  it("runs past the close to the last trade once both are over", () => {
    expect(chartEndTime(traded(10, 30 * S), 20 * S, 40 * S)).toBe(30 * S);
  });

  it("stops at the close when nothing traded after it", () => {
    expect(chartEndTime(traded(10, 5 * S), 20 * S, 40 * S)).toBe(20 * S);
  });

  it("runs to now while the session is still open", () => {
    expect(chartEndTime(traded(10, 5 * S), 60 * S, 40 * S)).toBe(40 * S);
  });

  it("runs to now when the session has no close", () => {
    expect(chartEndTime(traded(10, 5 * S), null, 40 * S)).toBe(40 * S);
  });

  it("takes the latest last point across the options", () => {
    const data = [...traded(10, 25 * S), ...traded(10, 30 * S), series([])];

    expect(chartEndTime(data, 20 * S, 40 * S)).toBe(30 * S);
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

  it("adds a point at every trade between grid steps", () => {
    const points = [
      { timestamp: 0, value: 125 },
      { timestamp: 60, value: 100 },
      { timestamp: 120, value: 150 },
      { timestamp: 120, value: 175 },
      { timestamp: S + 30, value: 200 },
    ];

    const built = buildChartSeries([series(points)], 0, 2 * S)[0]?.points;

    expect(built).toEqual([
      { timestamp: 0, value: 100 },
      { timestamp: 60, value: 100 },
      { timestamp: 120, value: 175 },
      { timestamp: S, value: 175 },
      { timestamp: S + 30, value: 200 },
      { timestamp: 2 * S, value: 200 },
    ]);
  });

  it("leaves out trades outside the drawn range", () => {
    const points = [
      { timestamp: 0, value: 125 },
      { timestamp: 60, value: 100 },
      { timestamp: 2 * S, value: 300 },
    ];

    expect(buildChartSeries([series(points)], 0, S)[0]?.points.map(({ timestamp }) => timestamp)).toEqual([0, 60, S]);
  });

  it("draws a trade after the close up to the bound chartEndTime gives", () => {
    // DevCon Arcade UP pool on 0 to 150: closes 13 Sep 12:00, last swap 30 Sep 23:57:40 at price 0.56126
    const closesAt = 1789300800;
    const lastSwap = 1790812660;
    const points = [
      { timestamp: 1788662160, value: 0.5 * 150 },
      { timestamp: 1789300000, value: 86.0 },
      { timestamp: lastSwap, value: 0.56126 * 150 },
    ];
    const data = [series(points, { lowerBound: 0, upperBound: 150 })];

    const built = buildChartSeries(data, 1787926020, chartEndTime(data, closesAt, 1793318400))[0]?.points;

    expect(built?.at(-1)).toEqual({ timestamp: lastSwap, value: 0.56126 * 150 });
  });

  it("draws a series with no points flat at the lower bound", () => {
    const empty = series([], { lowerBound: 100, upperBound: 500 });

    expect(values(buildChartSeries([empty], 0, S))).toEqual([100, 100]);
  });
});

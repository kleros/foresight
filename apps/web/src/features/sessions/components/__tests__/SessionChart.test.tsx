import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addresses } from "@/testing/fixtures";

import type { SessionChartData } from "../../types";
import { SessionChart } from "../SessionChart";

const drawn = vi.hoisted(() => [] as { time: number; value: number }[][]);

vi.mock("lightweight-charts", () => {
  const series = {
    setData: (points: { time: number; value: number }[]) => drawn.push(points),
    setSeriesOrder: () => {},
    applyOptions: () => {},
  };
  return {
    LineSeries: "Line",
    LineStyle: { Dashed: 2, SparseDotted: 4 },
    createChart: () => ({
      addSeries: () => series,
      applyOptions: () => {},
      timeScale: () => ({ fitContent: () => {} }),
      remove: () => {},
    }),
  };
});

// DevCon session 2, Arcade / Bowling Night UP pool: bounds 0 to 150, so an estimate is price * 150.
const OPENED_AT = 1787926020;
const CLOSES_AT = 1789300800;
const LAST_SWAP = 1790812660;
const NOW = 1793318400;
const estimate = (price: number) => price * 150;

const arcade: SessionChartData = [
  {
    option: {
      market: addresses.childMarkets[0]!,
      name: "Arcade / Bowling Night",
      color: "#ff0000",
      unit: null,
      lowerBound: 0,
      upperBound: 150,
    },
    points: [
      { timestamp: 1788662160, value: estimate(0.5) },
      { timestamp: 1788665760, value: estimate(0.50005) },
      { timestamp: 1789300000, value: 86.0 },
      { timestamp: 1790000000, value: 86.1 },
      { timestamp: 1790600000, value: 94.4 },
      { timestamp: LAST_SWAP, value: estimate(0.56126) },
    ],
  },
];

describe("SessionChart", () => {
  beforeEach(() => {
    drawn.length = 0;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws the trades after the session's close, ending on the last swap", () => {
    render(<SessionChart data={arcade} startTime={OPENED_AT} endTime={CLOSES_AT} noun="activities" />);

    const line = drawn.at(-1)!;
    expect(line.at(-1)).toEqual({ time: LAST_SWAP, value: estimate(0.56126) });
    expect(line).toContainEqual({ time: 1790600000, value: 94.4 });
  });
});

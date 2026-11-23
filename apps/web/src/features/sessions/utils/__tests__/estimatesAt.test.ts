import { describe, expect, it } from "vitest";

import { addresses } from "@/testing/fixtures";

import type { SessionChartData } from "../../types";
import { estimatesAt } from "../estimatesAt";

const option = (market: string) => ({
  market: market as never,
  name: "x",
  color: "#000",
  unit: null,
  lowerBound: 0,
  upperBound: 500,
});

const [FIRST, SECOND] = addresses.childMarkets;

describe("estimatesAt", () => {
  it("takes each option's newest point at or before the cutoff, leaving later trades out", () => {
    const data: SessionChartData = [
      {
        option: option(FIRST),
        points: [
          { timestamp: 10, value: 100 },
          { timestamp: 20, value: 250 },
          { timestamp: 30, value: 400 },
        ],
        seededValue: 50,
      },
    ];

    expect(estimatesAt(data, 20)).toEqual({ [FIRST.toLowerCase()]: 250 });
    expect(estimatesAt(data, 29)).toEqual({ [FIRST.toLowerCase()]: 250 });
    expect(estimatesAt(data, 30)).toEqual({ [FIRST.toLowerCase()]: 400 });
  });

  it("reads a pool whose first swap came after the cutoff at its seeded price", () => {
    const data: SessionChartData = [
      { option: option(FIRST), points: [{ timestamp: 30, value: 400 }], seededValue: 125 },
      { option: option(SECOND), points: [{ timestamp: 10, value: 280 }], seededValue: 125 },
    ];

    expect(estimatesAt(data, 20)).toEqual({ [FIRST.toLowerCase()]: 125, [SECOND.toLowerCase()]: 280 });
  });

  it("has no entry for an option whose pool never priced", () => {
    const data: SessionChartData = [{ option: option(FIRST), points: [] }];

    expect(estimatesAt(data, 20)).toEqual({});
  });
});

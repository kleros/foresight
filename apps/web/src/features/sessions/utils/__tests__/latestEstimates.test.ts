import { describe, expect, it } from "vitest";

import { addresses } from "@/testing/fixtures";

import type { SessionChartData } from "../../types";
import { latestEstimates } from "../latestEstimates";

const option = (market: string) => ({
  market: market as never,
  name: "x",
  color: "#000",
  unit: null,
  lowerBound: 0,
  upperBound: 500,
});

describe("latestEstimates", () => {
  it("takes the newest point of each option, keyed by lowercased market", () => {
    const upper = addresses.childMarkets[0].replace("0xc", "0xC");
    const data: SessionChartData = [
      {
        option: option(upper),
        points: [
          { timestamp: 1, value: 100 },
          { timestamp: 2, value: 312 },
        ],
      },
      { option: option(addresses.childMarkets[1]), points: [{ timestamp: 1, value: 280 }] },
    ];

    expect(latestEstimates(data)).toEqual({ [addresses.childMarkets[0]]: 312, [addresses.childMarkets[1]]: 280 });
  });

  it("leaves out an option whose pool never priced", () => {
    const data: SessionChartData = [{ option: option(addresses.childMarkets[0]), points: [] }];

    expect(latestEstimates(data)).toEqual({});
  });
});

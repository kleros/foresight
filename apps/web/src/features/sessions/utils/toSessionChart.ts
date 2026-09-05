import { fromWad } from "@/utils/amount";

import type { SessionChartQuery } from "@/lib/graphql/generated/graphql";

import type { SessionChartData, SessionChartPoint, SessionOption } from "../types";

const toEstimate = (underlyingPerOutcome: string | null | undefined, option: SessionOption): number | undefined => {
  if (underlyingPerOutcome == null) return undefined;

  return option.lowerBound + fromWad(underlyingPerOutcome) * (option.upperBound - option.lowerBound);
};

export function toSessionChart(result: SessionChartQuery, options: SessionOption[]): SessionChartData {
  // Indexer ids are lowercase; only the caller's option addresses need normalising.
  const poolByMarket = new Map(result.Pool.map((pool) => [pool.childMarket_id, pool]));

  const data: SessionChartData = [];
  for (const option of options) {
    const pool = poolByMarket.get(option.market.toLowerCase());

    const points: SessionChartPoint[] = [];
    for (const swap of pool?.swaps ?? []) {
      const value = toEstimate(swap.underlyingPerOutcomeAfter, option);
      if (value !== undefined) points.push({ timestamp: Number(swap.timestamp), value });
    }

    // A pool that initialised but never traded still has its seeded price.
    const current = toEstimate(pool?.underlyingPerOutcome, option);
    const last = points.at(-1);
    if (
      pool !== undefined &&
      current !== undefined &&
      (last === undefined || last.timestamp < Number(pool.updatedAt))
    ) {
      points.push({ timestamp: Number(pool.updatedAt), value: current });
    }

    data.push({
      option: {
        market: option.market,
        name: option.name,
        color: option.color,
        unit: option.unit,
        lowerBound: option.lowerBound,
        upperBound: option.upperBound,
      },
      points,
    });
  }

  return data;
}

import type { SessionChartData, SessionChartOption, SessionChartPoint } from "../types";

export const GRID_STEP_SECONDS = 60 * 60;

export const chartTimestamps = (firstTimestamp: number, lastTimestamp: number): number[] => {
  if (firstTimestamp > lastTimestamp) return [];

  let currentTimestamp = firstTimestamp;
  const timestamps: number[] = [];
  while (currentTimestamp <= lastTimestamp) {
    timestamps.push(currentTimestamp);
    currentTimestamp += GRID_STEP_SECONDS;
  }
  if (timestamps.at(-1) !== lastTimestamp) {
    timestamps.push(lastTimestamp);
  }

  return timestamps;
};

// A session's last trade can come after its resolution date, so the line runs to the later of the two;
// with no `closesAt`, as for a session still trading, it runs to now.
export function chartEndTime(data: SessionChartData, closesAt: number | null, now: number): number {
  const lastPoint = Math.max(0, ...data.map(({ points }) => points.at(-1)?.timestamp ?? 0));
  return Math.min(now, Math.max(closesAt ?? Number.POSITIVE_INFINITY, lastPoint));
}

// The first point is the pool's seeded price, not a trade; bound-pinned values are pre-liquidity noise.
const firstTradedIndex = (points: SessionChartPoint[], option: SessionChartOption): number => {
  const floor = option.lowerBound + 0.001 * (option.upperBound - option.lowerBound);

  for (const [i, point] of points.entries()) {
    const isExtreme = point.value >= option.upperBound || point.value < floor;
    if (!isExtreme && i > 0) return i;
  }

  return 0;
};

export function buildChartSeries(data: SessionChartData, startTime: number, endTime: number): SessionChartData {
  const timestamps = chartTimestamps(startTime, endTime);

  return data.map(({ option, points }) => {
    const normalized = points.slice(firstTradedIndex(points, option));
    const first = normalized[0];
    const tradeTimes = normalized.map((point) => point.timestamp).filter((t) => t > startTime && t < endTime);
    const times = [...new Set([...timestamps, ...tradeTimes])].sort((a, b) => a - b);

    const gridPoints = times.map((timestamp) => {
      if (first === undefined) return { timestamp, value: option.lowerBound };

      let closest = first;
      for (const point of normalized) {
        if (point.timestamp <= timestamp) closest = point;
        else break;
      }

      return { timestamp, value: closest.value };
    });

    return { option, points: gridPoints };
  });
}

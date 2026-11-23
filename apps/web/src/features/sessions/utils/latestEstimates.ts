import type { SessionChartData } from "../types";

/**
 * Where the market sits for each option, keyed by lowercased child market: now, or at `until` (unix seconds).
 * Before a pool's first swap it sat at its seeded price; an option with no price by then has no entry.
 */
export function latestEstimates(data: SessionChartData, until?: number): Record<string, number> {
  const estimates: Record<string, number> = {};
  for (const { option, points, seededValue } of data) {
    const shown = until === undefined ? points : points.filter(({ timestamp }) => timestamp <= until);
    const value = shown.at(-1)?.value ?? seededValue;
    if (value !== undefined) estimates[option.market.toLowerCase()] = value;
  }
  return estimates;
}

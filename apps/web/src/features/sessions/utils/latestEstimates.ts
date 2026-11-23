import type { SessionChartData } from "../types";

/**
 * Where the market sits for each option, keyed by lowercased child market: now, or at `until` (unix seconds) when
 * given. An option with no price by then has no entry.
 */
export function latestEstimates(data: SessionChartData, until?: number): Record<string, number> {
  const estimates: Record<string, number> = {};
  for (const { option, points } of data) {
    const shown = until === undefined ? points : points.filter(({ timestamp }) => timestamp <= until);
    const last = shown.at(-1);
    if (last !== undefined) estimates[option.market.toLowerCase()] = last.value;
  }
  return estimates;
}

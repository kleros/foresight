import type { SessionChartData } from "../types";

/**
 * Where the market sits now for each option, keyed by lowercased child market. An option whose
 * pool never priced has no entry.
 */
export function latestEstimates(data: SessionChartData): Record<string, number> {
  const estimates: Record<string, number> = {};
  for (const { option, points } of data) {
    const last = points.at(-1);
    if (last !== undefined) estimates[option.market.toLowerCase()] = last.value;
  }
  return estimates;
}

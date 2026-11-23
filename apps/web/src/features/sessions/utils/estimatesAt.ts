import type { SessionChartData } from "../types";

/**
 * Where each option's market stood at `cutoff` (unix seconds), keyed by lowercased child market: its last point
 * by then, else the price it was seeded at. An option whose pool never priced has no entry.
 */
export function estimatesAt(data: SessionChartData, cutoff: number): Record<string, number> {
  const estimates: Record<string, number> = {};
  for (const { option, points, seededValue } of data) {
    // points run oldest first
    const byCutoff = points.filter((point) => point.timestamp <= cutoff).at(-1);
    const value = byCutoff?.value ?? seededValue;
    if (value !== undefined) estimates[option.market.toLowerCase()] = value;
  }
  return estimates;
}

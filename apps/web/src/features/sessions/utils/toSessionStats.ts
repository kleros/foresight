import type { SessionStatsQuery } from "@/lib/graphql/generated/graphql";

import type { SessionStats } from "../types";

export function toSessionStats(result: SessionStatsQuery): SessionStats {
  return {
    traders: result.Prediction.length,
    volumeUnderlying: result.Pool.reduce((sum, pool) => sum + BigInt(pool.volumeUnderlying), 0n),
  };
}

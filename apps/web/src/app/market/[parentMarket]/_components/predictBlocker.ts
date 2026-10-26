import type { SessionOption, SessionStatus } from "@/features/sessions/types";

export type PredictBlocker = "closed" | "unfinished" | "no-liquidity" | "no-move" | "disconnected";

interface PredictBlockerArgs {
  status: SessionStatus;
  options: Pick<SessionOption, "market">[];
  marketEstimates: Record<string, number | undefined>;
  isMarketUnknown: boolean;
  selectedCount: number;
  isConnected: boolean;
  /** True while this wallet's unfinished run is stored for the session. */
  hasStoredRun?: boolean;
}

/**
 * Why Predict is off, one cause by priority: closed, then a stored run, then no liquidity, then no estimate
 * moved, then no wallet. Null when Predict is on, while setting up, and while the market numbers are not known.
 */
export function predictBlocker({
  status,
  options,
  marketEstimates,
  isMarketUnknown,
  selectedCount,
  isConnected,
  hasStoredRun = false,
}: PredictBlockerArgs): PredictBlocker | null {
  if (status === "closed") return "closed";
  if (hasStoredRun) return "unfinished";
  if (status !== "trading" || isMarketUnknown) return null;
  if (selectedCount > 0) return isConnected ? null : "disconnected";

  const hasLiquidity = options.some((option) => marketEstimates[option.market.toLowerCase()] !== undefined);
  return hasLiquidity ? "no-move" : "no-liquidity";
}

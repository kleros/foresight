import type { SessionOption, SessionStatus } from "@/features/sessions/types";

export type PredictBlocker = "closed" | "no-liquidity" | "no-move" | "disconnected";

interface PredictBlockerArgs {
  status: SessionStatus;
  options: Pick<SessionOption, "market">[];
  marketEstimates: Record<string, number | undefined>;
  isMarketUnknown: boolean;
  selectedCount: number;
  isConnected: boolean;
}

/**
 * Why Predict is off, one cause by priority: closed, then no liquidity, then no estimate moved,
 * then no wallet. Null when Predict is on, while setting up, and while the market numbers are not known.
 */
export function predictBlocker({
  status,
  options,
  marketEstimates,
  isMarketUnknown,
  selectedCount,
  isConnected,
}: PredictBlockerArgs): PredictBlocker | null {
  if (status === "closed") return "closed";
  if (status !== "trading" || isMarketUnknown) return null;
  if (selectedCount > 0) return isConnected ? null : "disconnected";

  const hasLiquidity = options.some((option) => marketEstimates[option.market.toLowerCase()] !== undefined);
  return hasLiquidity ? "no-move" : "no-liquidity";
}

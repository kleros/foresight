import { formatAmount } from "@/utils/amount";

import type { SessionDetail } from "../types";

/**
 * Pool volume arrives summed in outcome tokens. Minting one unit of collateral
 * yields one token of each of the N outcomes, so a token counts as 1/N collateral.
 */
export function collateralVolume(session: SessionDetail, volumeUnderlying: bigint): number | null {
  if (session.outcomeCount === 0) return null;

  return Number(formatAmount(volumeUnderlying, session.collateralDecimals ?? 18)) / session.outcomeCount;
}

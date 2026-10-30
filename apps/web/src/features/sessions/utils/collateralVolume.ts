import { formatAmount } from "@/utils/amount";

import type { SessionDetail } from "../types";

/**
 * An amount of a child market's underlying (a parent outcome token) in collateral. Minting one unit of
 * collateral yields one token of each of the N outcomes, so a token counts as 1/N collateral.
 */
export function collateralVolume(session: SessionDetail, underlying: bigint): number | null {
  if (session.outcomeCount === 0) return null;

  return Number(formatAmount(underlying, session.collateralDecimals ?? 18)) / session.outcomeCount;
}

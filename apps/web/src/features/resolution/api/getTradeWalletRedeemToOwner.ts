import type { PublicClient } from "viem";

import type { TradeWalletRedeemRequest } from "./getTradeWalletRedeem";
import type { OwnerPayout } from "../redeem/payOwner";
import type { RedeemPlan } from "../redeem/plan";
import type { RedeemScope } from "../redeem/tradeWalletBatchAllowed";

/** The ticked trade wallet redeem, with the owner and resolution it was read against on-chain. */
export async function readTradeWalletRedeemToOwner(
  _client: PublicClient,
  _request: TradeWalletRedeemRequest,
): Promise<{ plan: RedeemPlan; scope: RedeemScope; payout: OwnerPayout }> {
  throw new Error("not implemented");
}

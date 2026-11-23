import type { Address, PublicClient } from "viem";

import type { RedeemPlan } from "../redeem/plan";

export interface TradeWalletRedeemRequest {
  chainId: number;
  owner: Address;
  sessionFactory: Address;
  sessionId: bigint;
}

/** Reads the session's resolution, tokens and the owner's trade wallet balances on-chain, then plans the redeem. */
export async function fetchTradeWalletRedeem(
  _client: PublicClient,
  _request: TradeWalletRedeemRequest,
): Promise<RedeemPlan> {
  throw new Error("not implemented");
}

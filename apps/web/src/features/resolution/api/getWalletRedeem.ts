import type { Address, PublicClient } from "viem";

import { readRedeemInput } from "./getTradeWalletRedeem";
import type { WalletRedeemInput } from "../redeem/plan";

export interface WalletRedeemRequest {
  chainId: number;
  owner: Address;
  sessionFactory: Address;
  sessionId: bigint;
}

/** The session's resolution, its markets' `wrappedOutcome` tokens and `owner`'s own balances, read on-chain. */
export async function fetchWalletRedeemInput(
  client: PublicClient,
  request: WalletRedeemRequest,
): Promise<WalletRedeemInput> {
  return (await readRedeemInput(client, request, request.owner)).input;
}

import type { Address, PublicClient } from "viem";

import type { WalletRedeemInput } from "../redeem/plan";

export interface WalletRedeemRequest {
  chainId: number;
  owner: Address;
  sessionFactory: Address;
  sessionId: bigint;
}

export function fetchWalletRedeemInput(
  _client: PublicClient,
  _request: WalletRedeemRequest,
): Promise<WalletRedeemInput> {
  throw new Error("not implemented");
}

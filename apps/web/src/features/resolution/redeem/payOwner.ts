import type { FlowTx } from "@foresight/tx-orchestrator";
import type { Address } from "viem";

import type { RedeemPlan, TradeWalletRedeemInput } from "./plan";
import type { RedeemScope } from "./tradeWalletBatchAllowed";
import type { SessionResolution } from "../api/getSessionResolution";

/** What a ticked trade wallet batch is checked against, read on-chain: the trade wallet's `owner()` and the resolution. */
export interface OwnerPayout {
  owner: Address;
  resolution: SessionResolution;
}

/** The trade wallet redeem with the pay-to-owner box ticked (spec D12, oracle R3). */
export function planTradeWalletRedeemToOwner(_input: TradeWalletRedeemInput, _owner: Address): RedeemPlan {
  throw new Error("not implemented");
}

/** Every way a ticked trade wallet batch departs from oracle R2 to R5; empty when it keeps to them. */
export function ownerPayBatchDepartures(_args: {
  tx: FlowTx;
  chainId: number;
  account: Address;
  scope: RedeemScope;
  payout: OwnerPayout;
}): string[] {
  throw new Error("not implemented");
}

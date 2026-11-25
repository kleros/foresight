import type { PublicClient } from "viem";

import { executorAddress } from "@/lib/trade-executor/executor";

import { tradeExecutorAbi, tradeExecutorFactoryAddress } from "@/config/contracts";

import { readRedeemInput, type TradeWalletRedeemRequest } from "./getTradeWalletRedeem";
import { planTradeWalletRedeemToOwner, type OwnerPayout } from "../redeem/payOwner";
import type { RedeemPlan } from "../redeem/plan";
import type { RedeemScope } from "../redeem/tradeWalletBatchAllowed";

/** The ticked trade wallet redeem, with the owner and resolution it was read against on-chain. */
export async function readTradeWalletRedeemToOwner(
  client: PublicClient,
  request: TradeWalletRedeemRequest,
): Promise<{ plan: RedeemPlan; scope: RedeemScope; payout: OwnerPayout }> {
  const factory = tradeExecutorFactoryAddress(request.chainId);
  if (!factory) throw new Error(`Redeem is not available on chain ${request.chainId}.`);
  const tradeWallet = executorAddress(factory, request.owner);
  const [{ input, scope }, owner] = await Promise.all([
    readRedeemInput(client, request, tradeWallet),
    client.readContract({ address: tradeWallet, abi: tradeExecutorAbi, functionName: "owner" }),
  ]);
  return {
    plan: planTradeWalletRedeemToOwner(input, owner),
    scope,
    payout: { owner, resolution: input.resolution },
  };
}

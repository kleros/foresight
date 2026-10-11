"use client";

import type { Address } from "viem";

import { useSavingsRate } from "@/features/predict/api/getSavingsRate";
import type { PayToken } from "@/features/predict/types";
import { planFunding, type Funding } from "@/features/predict/utils/funding";
import { useFunds } from "@/features/trade-executor/api/getFunds";

import { sDaiDepositRoute } from "@/config/contracts";

/** Balances behind a prediction, and how `amount` would be funded from them. */
export function usePredictFunding(args: {
  owner: Address | undefined;
  /** The owner's trade wallet, deployed or not. */
  tradeWallet: Address | undefined;
  collateral: Address | null;
  token: PayToken;
  amount: bigint;
}): { funding: Funding | null; canPayNative: boolean; isPending: boolean } {
  const { owner, tradeWallet, collateral, token, amount } = args;
  const route = collateral ? sDaiDepositRoute(collateral) : null;
  const native = token === "native" && route !== null;

  const own = useFunds(owner, collateral ?? undefined);
  const held = useFunds(tradeWallet, collateral ?? undefined);
  const rate = useSavingsRate(native ? route.sDai : undefined);

  const isPending = own.isPending || held.isPending || (native && rate.isPending);
  if (isPending || !own.data || !held.data || (native && rate.data === undefined)) {
    return { funding: null, canPayNative: route !== null, isPending };
  }

  return {
    funding: planFunding({
      amount,
      ownWallet: native ? own.data.native : (own.data.token ?? 0n),
      tradeWallet: held.data.token ?? 0n,
      tokenPerCollateralWad: native ? rate.data : undefined,
    }),
    canPayNative: route !== null,
    isPending: false,
  };
}

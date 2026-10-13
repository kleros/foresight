"use client";

import type { Address } from "viem";

import { useSavingsRate } from "@/features/predict/api/getSavingsRate";
import type { PayToken } from "@/features/predict/types";
import { planFunding, type Funding } from "@/features/predict/utils/funding";
import { useFunds } from "@/features/trade-executor/api/getFunds";

import { sDaiDepositRoute } from "@/config/contracts";

const WAD = 10n ** 18n;

/** Balances behind a prediction, and how `amount` would be funded from them. */
export function usePredictFunding(args: {
  owner: Address | undefined;
  /** The owner's trade wallet, deployed or not. */
  tradeWallet: Address | undefined;
  collateral: Address | null;
  /** Undefined picks the token the owner's wallet holds more of, by collateral value. */
  token: PayToken | undefined;
  amount: bigint;
}): {
  funding: Funding | null;
  /** The token `funding` is in; undefined until the balances say which one to default to. */
  token: PayToken | undefined;
  /** What can be put in, in the given token; undefined while its balances are being read. */
  available: (token: PayToken) => bigint | undefined;
  canPayNative: boolean;
} {
  const { owner, tradeWallet, collateral, amount } = args;
  const route = collateral ? sDaiDepositRoute(collateral) : null;

  const own = useFunds(owner, collateral ?? undefined);
  const held = useFunds(tradeWallet, collateral ?? undefined);
  const rate = useSavingsRate(route?.sDai);

  const plan = (token: PayToken, value: bigint): Funding | null => {
    if (own.isPending || held.isPending || !own.data || !held.data) return null;
    if (token === "collateral") {
      return planFunding({ amount: value, ownWallet: own.data.token ?? 0n, tradeWallet: held.data.token ?? 0n });
    }
    if (route === null || rate.data === undefined) return null;
    return planFunding({
      amount: value,
      ownWallet: own.data.native,
      tradeWallet: held.data.token ?? 0n,
      tokenPerCollateralWad: rate.data,
    });
  };

  const available = (token: PayToken) => plan(token, 0n)?.available;
  const token = args.token ?? preferredToken(available, route === null || rate.isError, rate.data);

  return {
    funding: token ? plan(token, amount) : null,
    token,
    available,
    canPayNative: route !== null,
  };
}

/** Native only when it is worth strictly more than the collateral; the collateral otherwise. */
function preferredToken(
  available: (token: PayToken) => bigint | undefined,
  collateralOnly: boolean,
  tokenPerCollateralWad: bigint | undefined,
): PayToken | undefined {
  const collateral = available("collateral");
  if (collateral === undefined) return undefined;
  if (collateralOnly) return "collateral";
  const native = available("native");
  if (native === undefined || tokenPerCollateralWad === undefined) return undefined;
  return native * WAD > collateral * tokenPerCollateralWad ? "native" : "collateral";
}

"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

import { STALE_TIME } from "@/lib/query";
import { fetchHolderFunds } from "@/lib/trade-executor/balances";
import { publicClient } from "@/lib/web3/public-client";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

/** Every funds query hangs under this, so one invalidation refreshes them all. */
export const fundsKeyPrefix = ["trade-executor-funds"] as const;

export const fundsKey = (holder?: Address, token?: Address) =>
  [...fundsKeyPrefix, DEFAULT_CHAIN_ID, holder, token] as const;

/** Native balance of a holder, plus its balance of `token` when one is given. */
export function useFunds(holder: Address | undefined, token: Address | undefined) {
  return useQuery({
    queryKey: fundsKey(holder, token),
    queryFn: holder ? () => fetchHolderFunds(publicClient, { holder, token }) : skipToken,
    staleTime: STALE_TIME.balance,
  });
}

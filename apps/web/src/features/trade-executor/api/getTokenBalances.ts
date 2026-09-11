"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

import { STALE_TIME } from "@/lib/query";
import { fetchTokenBalances } from "@/lib/trade-executor/balances";
import { publicClient } from "@/lib/web3/public-client";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { fundsKeyPrefix } from "./getFunds";

export const tokenBalancesKey = (holder?: Address, tokens: Address[] = []) =>
  [...fundsKeyPrefix, DEFAULT_CHAIN_ID, holder, "tokens", tokens] as const;

/** One holder's balance of each token, in the order asked for. */
export function useTokenBalances(holder: Address | undefined, tokens: Address[]) {
  return useQuery({
    queryKey: tokenBalancesKey(holder, tokens),
    queryFn: holder ? () => fetchTokenBalances(publicClient, { holder, tokens }) : skipToken,
    staleTime: STALE_TIME.balance,
  });
}

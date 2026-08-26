"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

import { STALE_TIME } from "@/lib/query";
import { fetchTokenMeta } from "@/lib/trade-executor/balances";
import { publicClient } from "@/lib/web3/public-client";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

export const tokenMetaKey = (token?: Address) => ["trade-executor-token", DEFAULT_CHAIN_ID, token] as const;

/** Symbol and decimals of a token. */
export function useTokenMeta(token: Address | undefined) {
  return useQuery({
    queryKey: tokenMetaKey(token),
    queryFn: token ? () => fetchTokenMeta(publicClient, token) : skipToken,
    staleTime: STALE_TIME.immutable,
    // An address that is not a token fails on the first read; retrying will not change that.
    retry: false,
  });
}

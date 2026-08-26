"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { useAccount } from "wagmi";

import { STALE_TIME } from "@/lib/query";
import { fetchExecutorState } from "@/lib/trade-executor/executor";
import { publicClient } from "@/lib/web3/public-client";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { tradeExecutorFactoryAddress } from "@/config/contracts";

/** Prefix for invalidating every owner's executor state at once. */
export const executorKeyPrefix = ["trade-executor", DEFAULT_CHAIN_ID] as const;

export const executorKey = (owner?: Address) => [...executorKeyPrefix, owner] as const;

/** The connected account's executor: where it will deploy, and whether it has. */
export function useExecutor() {
  const { address: owner } = useAccount();
  const factory = tradeExecutorFactoryAddress(DEFAULT_CHAIN_ID);

  return useQuery({
    queryKey: executorKey(owner),
    queryFn: owner && factory ? () => fetchExecutorState(publicClient, { factory, owner }) : skipToken,
    staleTime: STALE_TIME.structural,
  });
}

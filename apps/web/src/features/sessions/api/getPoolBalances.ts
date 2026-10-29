"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import { erc20Abi, formatEther, parseAbi, parseEther, type Address, type PublicClient } from "viem";

import { STALE_TIME } from "@/lib/query";
import { publicClient } from "@/lib/web3/public-client";

import { sDaiDepositRoute } from "@/config/contracts";

import type { PoolBalances, SessionPool } from "../types";
import { sessionStatsKey } from "./getSessionStats";

/** Each pool's own balance of its outcome and underlying token, uncollected LP fees included. */
export async function fetchPoolBalances(client: PublicClient, pools: SessionPool[]): Promise<PoolBalances> {
  if (pools.length === 0) return {};
  const reads = (await client.multicall({
    contracts: pools.flatMap((pool) =>
      [pool.outcomeToken, pool.underlyingToken].map((token) => ({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [pool.id] as const,
      })),
    ),
    allowFailure: false,
    batchSize: 0,
  })) as bigint[];
  return Object.fromEntries(
    pools.map((pool, index) => [pool.id, { outcome: reads[index * 2]!, underlying: reads[index * 2 + 1]! }]),
  );
}

// under the stats key, so the refresh after a trade that invalidates the stats rereads these too
export function usePoolBalances(sessionId: string | undefined, pools: SessionPool[] | undefined) {
  return useQuery({
    queryKey: [...sessionStatsKey(sessionId), "pool-balances", pools?.map((pool) => pool.id)],
    queryFn: pools ? () => fetchPoolBalances(publicClient, pools) : skipToken,
    staleTime: STALE_TIME.live,
  });
}

const VAULT_ABI = parseAbi(["function previewRedeem(uint256 shares) view returns (uint256)"]);

/** xDAI, taken as USD, that one sDAI redeems for; nothing unless `collateral` is sDAI. */
export function useSDaiUsdPrice(collateral: Address | null | undefined) {
  const isSDai = collateral ? sDaiDepositRoute(collateral) !== null : false;
  return useQuery({
    queryKey: ["sdai-usd-price", collateral?.toLowerCase()],
    queryFn:
      collateral && isSDai
        ? async () =>
            Number(
              formatEther(
                await publicClient.readContract({
                  address: collateral,
                  abi: VAULT_ABI,
                  functionName: "previewRedeem",
                  args: [parseEther("1")],
                }),
              ),
            )
        : skipToken,
    staleTime: STALE_TIME.live,
  });
}

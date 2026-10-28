"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import { erc20Abi, hexToBigInt, parseAbi, type Address, type PublicClient } from "viem";

import { STALE_TIME } from "@/lib/query";
import { publicClient } from "@/lib/web3/public-client";

import type { LiquiditySession, MergeInput } from "../types";
import { liquidityKeyPrefix } from "./getLiquidityPools";

export type LiquidityBalances = MergeInput["balances"] & { collateral: bigint; native: bigint };

/** The owner's balance of every token of the session, sDAI and xDAI. */
export async function fetchLiquidityBalances(
  client: PublicClient,
  { session, owner }: { session: LiquiditySession; owner: Address },
): Promise<LiquidityBalances> {
  const tokens = [
    session.collateral,
    session.parentInvalid,
    ...session.branches.flatMap((branch) => [branch.outcome, branch.upToken, branch.downToken, branch.invalidToken]),
  ];
  const [reads, native] = await Promise.all([
    client.multicall({
      contracts: tokens.map((address) => ({
        address,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [owner] as const,
      })),
      allowFailure: false,
      batchSize: 0,
    }),
    // read directly: viem batches getBalance through multicall3's getEthBalance
    client.request({ method: "eth_getBalance", params: [owner, "latest"] }).then(hexToBigInt),
  ]);
  const [collateral, parentInvalid, ...rest] = reads as bigint[];
  return {
    collateral: collateral!,
    native,
    parentInvalid: parentInvalid!,
    branches: session.branches.map((_, index) => {
      const [outcome, up, down, invalid] = rest.slice(index * 4, index * 4 + 4) as [bigint, bigint, bigint, bigint];
      return { outcome, up, down, invalid };
    }),
  };
}

export function useLiquidityBalances(session: LiquiditySession | undefined, owner: Address | undefined) {
  return useQuery({
    queryKey: [...liquidityKeyPrefix, "balances", session?.parentMarket.toLowerCase(), owner?.toLowerCase()],
    queryFn: session && owner ? () => fetchLiquidityBalances(publicClient, { session, owner }) : skipToken,
    staleTime: STALE_TIME.live,
  });
}

const VAULT_ABI = parseAbi(["function previewDeposit(uint256 assets) view returns (uint256)"]);

/** The sDAI shares `assets` xDAI deposits to now; an xDAI seed is planned against it (L12). */
export function useSDaiPreviewDeposit(collateral: Address | undefined, assets: bigint | undefined) {
  return useQuery({
    queryKey: [...liquidityKeyPrefix, "previewDeposit", collateral?.toLowerCase(), assets?.toString()],
    queryFn:
      collateral && assets
        ? () =>
            publicClient.readContract({
              address: collateral,
              abi: VAULT_ABI,
              functionName: "previewDeposit",
              args: [assets],
            })
        : skipToken,
    staleTime: STALE_TIME.live,
  });
}

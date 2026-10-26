"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import { erc4626Abi, type Address } from "viem";

import { STALE_TIME } from "@/lib/query";
import { publicClient } from "@/lib/web3/public-client";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

const WAD = 10n ** 18n;

/** xDAI one sDAI redeems for, as a wad. */
export function useSavingsRate(sDai: Address | undefined) {
  return useQuery({
    queryKey: ["savings-rate", DEFAULT_CHAIN_ID, sDai],
    queryFn: sDai
      ? () =>
          publicClient.readContract({ address: sDai, abi: erc4626Abi, functionName: "convertToAssets", args: [WAD] })
      : skipToken,
    staleTime: STALE_TIME.live,
  });
}

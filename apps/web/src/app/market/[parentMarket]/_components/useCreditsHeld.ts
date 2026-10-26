"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

import { fundsKeyPrefix } from "@/features/trade-executor/api/getFunds";

import { STALE_TIME } from "@/lib/query";
import { fetchCredits } from "@/lib/trade-executor/credits";
import { publicClient } from "@/lib/web3/public-client";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { creditsContracts } from "@/config/contracts";

/** Under the funds prefix, so a run's refresh of the balances refreshes the credits too. */
const creditsKey = (owner?: Address, tradeWallet?: Address, collateral?: Address) =>
  [...fundsKeyPrefix, "credits", DEFAULT_CHAIN_ID, owner, tradeWallet, collateral] as const;

/** Skipped on a chain without credits contracts, where it never loads and holds no data. */
export function useCreditsHeld(
  owner: Address | undefined,
  tradeWallet: Address | undefined,
  collateral: Address | null,
) {
  const contracts = creditsContracts(DEFAULT_CHAIN_ID);
  return useQuery({
    queryKey: creditsKey(owner, tradeWallet, collateral ?? undefined),
    queryFn:
      contracts && owner && tradeWallet && collateral
        ? () => fetchCredits(publicClient, { contracts, owner, tradeWallet, collateral })
        : skipToken,
    staleTime: STALE_TIME.balance,
    // optional to a prediction, so a failed read gives way to the visitor's own money at once
    retry: false,
  });
}

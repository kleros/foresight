"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

import { previewCreditsSwap } from "@/features/predict/flow/plan";
import type { CreditsSwapPreview } from "@/features/predict/flow/types";
import { createPredictReader } from "@/features/predict/run/reader";

import { createLensExactInputQuoter } from "@/lib/swap/lens";
import { publicClient } from "@/lib/web3/public-client";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { creditsRoute } from "@/config/contracts";

/**
 * The credits swap a run spending `credits` would make now, for Details and for the run to be held to;
 * none while nothing is spent. `failed` once the quote could not be had.
 */
export function useCreditsSwapPreview(args: {
  sessionId: string;
  collateral: Address | null;
  /** The owner's trade wallet, which the swap pays. */
  tradeWallet: Address | undefined;
  credits: bigint;
  creditsBps: number;
}): { preview?: CreditsSwapPreview; failed: boolean } {
  const { sessionId, collateral, tradeWallet, credits, creditsBps } = args;
  const route = collateral ? creditsRoute(collateral, DEFAULT_CHAIN_ID) : null;

  const query = useQuery({
    queryKey: ["credits-swap-preview", collateral, tradeWallet, credits.toString(), creditsBps],
    queryFn: () =>
      previewCreditsSwap({ collateral: collateral!, executor: tradeWallet!, credits: route }, credits, creditsBps, {
        reader: createPredictReader({ client: publicClient, sessionId, collateral: collateral!, credits: route }),
        creditsQuoter: createLensExactInputQuoter(publicClient, DEFAULT_CHAIN_ID as 100),
      }),
    enabled: collateral !== null && route !== null && tradeWallet !== undefined && credits > 0n,
  });
  return credits > 0n ? { preview: query.data, failed: query.isError } : { failed: false };
}

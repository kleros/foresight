"use client";

import { useEffect, useRef } from "react";

import { useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";

import { usePredictRun, type PredictRunInput } from "@/features/predict/hooks/usePredictRun";
import type { SelectedEstimate } from "@/features/predict/types";
import { fundingRequest, type Funding } from "@/features/predict/utils/funding";
import { sessionChartKey } from "@/features/sessions/api/getSessionChart";
import { refreshSessionAfterTrade } from "@/features/sessions/api/getSessionStats";
import type { SessionDetail } from "@/features/sessions/types";
import { executorKey } from "@/features/trade-executor/api/getExecutor";
import { fundsKeyPrefix } from "@/features/trade-executor/api/getFunds";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { creditsRoute, gnosisRouterAddress, sDaiDepositRoute, tradeExecutorFactoryAddress } from "@/config/contracts";

import { toPredictOptions } from "./toPredictOptions";

/** The prediction run for this session, and the caches it refreshes when a run completes or stops. */
export function usePredictExecution(args: {
  session: SessionDetail;
  selected: SelectedEstimate[];
  owner: Address | undefined;
  chainId: number | undefined;
  /** The owner's trade wallet, deployed or not. */
  tradeWallet: Address | undefined;
  funding: Funding | null;
  native: boolean;
}) {
  const { session, selected, owner, chainId, tradeWallet } = args;
  const queryClient = useQueryClient();

  const router = gnosisRouterAddress(DEFAULT_CHAIN_ID);
  const factory = tradeExecutorFactoryAddress(DEFAULT_CHAIN_ID);
  const { collateralToken } = session;

  // read when the button is pressed, not when the run is built
  const fundingRef = useRef({ funding: args.funding, native: args.native });
  fundingRef.current = { funding: args.funding, native: args.native };

  const input: PredictRunInput | null =
    owner !== undefined &&
    chainId === DEFAULT_CHAIN_ID &&
    router !== null &&
    factory !== null &&
    tradeWallet !== undefined &&
    collateralToken !== null
      ? {
          sessionId: session.id,
          parentMarket: session.parentMarket,
          collateral: collateralToken,
          router,
          factory,
          owner,
          executor: tradeWallet,
          sDaiAdapter: sDaiDepositRoute(collateralToken, DEFAULT_CHAIN_ID)?.sDaiAdapter ?? null,
          credits: creditsRoute(collateralToken, DEFAULT_CHAIN_ID),
          options: () => toPredictOptions(session, selected),
          funding: () => {
            const { funding, native } = fundingRef.current;
            return funding
              ? fundingRequest(funding, native)
              : {
                  deposit: 0n,
                  depositNative: native,
                  collateralIn: 0n,
                  collateralBefore: 0n,
                  creditsFromEoa: 0n,
                  creditsToSpend: 0n,
                };
          },
          onComplete: () => {
            void queryClient.invalidateQueries({ queryKey: fundsKeyPrefix });
            void queryClient.invalidateQueries({ queryKey: executorKey(owner) });
            void queryClient.invalidateQueries({ queryKey: sessionChartKey(session.id) });
            void refreshSessionAfterTrade(queryClient, session.id);
          },
        }
      : null;

  const { driver, progress } = usePredictRun(input);
  const stage = progress?.stage ?? "idle";

  useEffect(() => {
    // a stopped run may have created the wallet or added funds, which the balances must show
    if (stage !== "halted") return;
    void queryClient.invalidateQueries({ queryKey: fundsKeyPrefix });
    void queryClient.invalidateQueries({ queryKey: executorKey(owner) });
  }, [stage, queryClient, owner]);

  return { driver, progress, ready: input !== null };
}

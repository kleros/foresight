"use client";

import { useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";

import { PredictDialog } from "@/features/predict/components/PredictDialog";
import { usePredictRun, type PredictRunInput } from "@/features/predict/hooks/usePredictRun";
import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import type { SelectedEstimate } from "@/features/predict/types";
import { sessionChartKey } from "@/features/sessions/api/getSessionChart";
import type { SessionDetail } from "@/features/sessions/types";
import { executorKey, useExecutor } from "@/features/trade-executor/api/getExecutor";
import { fundsKeyPrefix, useFunds } from "@/features/trade-executor/api/getFunds";

import { estimateToPriceWad } from "@/utils/optionPrice";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { gnosisRouterAddress, sDaiDepositRoute, tradeExecutorFactoryAddress } from "@/config/contracts";

interface PredictRunnerProps {
  session: SessionDetail;
  selected: SelectedEstimate[];
  onClose: () => void;
}

/**
 * Everything behind the predict button, mounted only once it is pressed: the wallet, the run and
 * the popup. Kept out of the page so the route does not carry the orchestrator and the quoter.
 */
export function PredictRunner({ session, selected, onClose }: PredictRunnerProps) {
  const { address: owner, chainId } = useAccount();
  const queryClient = useQueryClient();
  const [deposit] = useState(() => ({ current: 0n }));

  const clearEstimate = useEstimateStore((state) => state.clearEstimate);
  const executor = useExecutor();
  const funds = useFunds(owner, session.collateralToken ?? undefined);

  const router = gnosisRouterAddress(DEFAULT_CHAIN_ID);
  const factory = tradeExecutorFactoryAddress(DEFAULT_CHAIN_ID);
  const predicted = executor.data?.predicted;
  const { collateralToken } = session;

  const input: PredictRunInput | null =
    owner !== undefined &&
    chainId === DEFAULT_CHAIN_ID &&
    router !== null &&
    factory !== null &&
    predicted !== undefined &&
    collateralToken !== null
      ? {
          sessionId: session.id,
          parentMarket: session.parentMarket,
          collateral: collateralToken,
          router,
          factory,
          owner,
          executor: predicted,
          sDaiAdapter: sDaiDepositRoute(collateralToken, DEFAULT_CHAIN_ID)?.sDaiAdapter ?? null,
          options: () =>
            selected.flatMap((estimate) => {
              const option = session.options.find((each) => each.market === estimate.scale.market);
              if (!option?.upToken || !option.downToken || !option.underlyingToken || !option.invalidToken) {
                return [];
              }
              return [
                {
                  childMarket: option.market,
                  underlying: option.underlyingToken,
                  upToken: option.upToken,
                  downToken: option.downToken,
                  // each child wraps its own INVALID; the decision's would not burn here
                  invalidToken: option.invalidToken,
                  targetPriceWad: estimateToPriceWad(estimate.value, option),
                },
              ];
            }),
          deposit: () => deposit.current,
          depositNative: () => false,
          onComplete: () => {
            void queryClient.invalidateQueries({ queryKey: fundsKeyPrefix });
            void queryClient.invalidateQueries({ queryKey: executorKey(owner) });
            void queryClient.invalidateQueries({ queryKey: sessionChartKey(session.id) });
          },
        }
      : null;

  const { driver, progress } = usePredictRun(input);

  const close = () => {
    if (progress?.stage === "complete" || progress?.stage === "halted") driver?.reset();
    onClose();
  };

  return (
    <PredictDialog
      isOpen
      onClose={close}
      selected={selected}
      funds={{
        balance: funds.data?.token ?? 0n,
        symbol: session.collateralSymbol ?? "sDAI",
        decimals: session.collateralDecimals ?? 18,
        isPending: funds.isPending,
      }}
      notice={
        // once a run is going its own state is the story, not what the wallet is doing now
        progress !== null && progress.stage !== "idle"
          ? undefined
          : notice({ owner, onRightChain: chainId === DEFAULT_CHAIN_ID, ready: input !== null })
      }
      progress={progress}
      onRemove={(market) => clearEstimate(session.parentMarket, market)}
      onConfirm={(amount) => {
        deposit.current = amount;
        driver?.start();
      }}
      onRetry={() => driver?.retry()}
    />
  );
}

/** Why this prediction cannot be made, in the words of the thing the visitor has to do. */
function notice(args: { owner?: string; onRightChain: boolean; ready: boolean }): string | undefined {
  if (!args.owner) return "Connect a wallet to make this prediction.";
  if (!args.onRightChain) return "Switch to Gnosis to make this prediction.";
  return args.ready ? undefined : "This session cannot be traded yet.";
}

"use client";

import { useEffect, useRef, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";

import type { PayTokenChoice } from "@/features/predict/components/PredictAmountSection";
import { PredictDialog } from "@/features/predict/components/PredictDialog";
import { usePredictRun, type PredictRunInput } from "@/features/predict/hooks/usePredictRun";
import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import type { PayToken, SelectedEstimate } from "@/features/predict/types";
import type { Funding } from "@/features/predict/utils/funding";
import { predictSteps } from "@/features/predict/utils/predictSteps";
import { sessionChartKey } from "@/features/sessions/api/getSessionChart";
import type { SessionDetail } from "@/features/sessions/types";
import { executorKey, useExecutor } from "@/features/trade-executor/api/getExecutor";
import { fundsKeyPrefix } from "@/features/trade-executor/api/getFunds";

import { estimateToPriceWad } from "@/utils/optionPrice";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { gnosisRouterAddress, sDaiDepositRoute, tradeExecutorFactoryAddress } from "@/config/contracts";

import { useHasPredicted } from "./useHasPredicted";
import { usePredictFunding } from "./usePredictFunding";

interface PredictRunnerProps {
  session: SessionDetail;
  selected: SelectedEstimate[];
  onClose: () => void;
  onSuccess: () => void;
}

const NATIVE: PayTokenChoice = { id: "native", symbol: "xDAI", decimals: 18 };

/**
 * Everything behind the predict button, mounted only once it is pressed: the wallet, the run and
 * the popup. Kept out of the page so the route does not carry the orchestrator and the quoter.
 */
export function PredictRunner({ session, selected, onClose, onSuccess }: PredictRunnerProps) {
  const { address: owner, chainId } = useAccount();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState<bigint>();
  const [tokenId, setTokenId] = useState<PayToken>("collateral");
  // what the steps say is being added, held from the press so a refreshed balance cannot rewrite it
  const [frozenToAdd, setFrozenToAdd] = useState<bigint>();

  const clearEstimate = useEstimateStore((state) => state.clearEstimate);
  const executor = useExecutor();

  const router = gnosisRouterAddress(DEFAULT_CHAIN_ID);
  const factory = tradeExecutorFactoryAddress(DEFAULT_CHAIN_ID);
  const predicted = executor.data?.predicted;
  const { collateralToken } = session;

  const collateral = { symbol: session.collateralSymbol ?? "sDAI", decimals: session.collateralDecimals ?? 18 };
  const { funding, canPayNative } = usePredictFunding({
    owner,
    tradeWallet: predicted,
    collateral: collateralToken,
    token: tokenId,
    amount: amount ?? 0n,
  });
  const isFirstPrediction = !useHasPredicted(predicted, session);

  const tokens: PayTokenChoice[] = [{ id: "collateral", ...collateral }, ...(canPayNative ? [NATIVE] : [])];
  const token = tokens.find((choice) => choice.id === tokenId) ?? tokens[0]!;

  // read when the button is pressed, not when the run is built
  const fundingRef = useRef<{ funding: Funding | null; native: boolean }>({ funding: null, native: false });
  fundingRef.current = { funding, native: token.id === "native" };

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
          deposit: () => fundingRef.current.funding?.deposit ?? 0n,
          depositNative: () => fundingRef.current.native,
          collateralIn: () => fundingRef.current.funding?.collateralIn ?? 0n,
          collateralBefore: () => fundingRef.current.funding?.tradeWallet ?? 0n,
          onComplete: () => {
            void queryClient.invalidateQueries({ queryKey: fundsKeyPrefix });
            void queryClient.invalidateQueries({ queryKey: executorKey(owner) });
            void queryClient.invalidateQueries({ queryKey: sessionChartKey(session.id) });
          },
        }
      : null;

  const { driver, progress } = usePredictRun(input);
  const stage = progress?.stage ?? "idle";
  const isRunning = stage === "quoting" || stage === "signing" || stage === "confirming";

  useEffect(() => {
    // a stopped run may have created the wallet or added funds, which the balances must show
    if (stage === "halted") {
      void queryClient.invalidateQueries({ queryKey: fundsKeyPrefix });
      void queryClient.invalidateQueries({ queryKey: executorKey(owner) });
    }
    if (stage !== "complete") return;
    driver?.reset();
    onSuccess();
  }, [stage, driver, onSuccess, queryClient, owner]);

  const close = () => {
    if (stage === "halted") driver?.reset();
    onClose();
  };

  const predict = () => {
    if (stage === "halted" && progress?.failure?.retryable) {
      driver?.retry();
      return;
    }
    if (stage === "halted") driver?.reset();
    setFrozenToAdd(funding?.toAdd);
    driver?.start();
  };

  const steps = predictSteps({
    wallet: predicted ? { address: predicted, deployed: Boolean(executor.data?.deployed) } : null,
    toAdd: (stage === "idle" ? undefined : frozenToAdd) ?? funding?.toAdd ?? 0n,
    symbol: collateral.symbol,
    decimals: collateral.decimals,
    progress,
  });

  return (
    <PredictDialog
      isOpen
      onClose={close}
      selected={selected}
      onRemove={(market) => clearEstimate(session.parentMarket, market)}
      amount={amount}
      onAmountChange={setAmount}
      tokens={tokens}
      token={token}
      onTokenChange={(next) => {
        setTokenId(next);
        setAmount(undefined);
      }}
      funding={funding}
      collateral={collateral}
      isFirstPrediction={isFirstPrediction}
      steps={steps}
      skipped={progress?.skipped.length ?? 0}
      isRunning={isRunning}
      notice={
        // once a run is going its own state is the story, not what the wallet is doing now
        isRunning ? undefined : notice({ owner, onRightChain: chainId === DEFAULT_CHAIN_ID, ready: input !== null })
      }
      onPredict={predict}
    />
  );
}

/** Why this prediction cannot be made, in the words of the thing the visitor has to do. */
function notice(args: { owner?: string; onRightChain: boolean; ready: boolean }): string | undefined {
  if (!args.owner) return "Connect a wallet to make this prediction.";
  if (!args.onRightChain) return "Switch to Gnosis to make this prediction.";
  return args.ready ? undefined : "This session cannot be traded yet.";
}

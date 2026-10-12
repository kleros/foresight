"use client";

import { useEffect, useState } from "react";

import { useAccount } from "wagmi";

import type { PayTokenChoice } from "@/features/predict/components/PredictAmountSection";
import { PredictDialog } from "@/features/predict/components/PredictDialog";
import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import type { PayToken, SelectedEstimate } from "@/features/predict/types";
import { predictSteps } from "@/features/predict/utils/predictSteps";
import type { SessionDetail } from "@/features/sessions/types";
import { useExecutor } from "@/features/trade-executor/api/getExecutor";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { useHasPredicted } from "./useHasPredicted";
import { usePredictExecution } from "./usePredictExecution";
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

  const [amount, setAmount] = useState<bigint>();
  const [tokenId, setTokenId] = useState<PayToken>("collateral");
  // what the steps say is being added, held from the press so a refreshed balance cannot rewrite it
  const [frozenToAdd, setFrozenToAdd] = useState<bigint>();

  const clearEstimate = useEstimateStore((state) => state.clearEstimate);
  const executor = useExecutor();

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

  const { driver, progress, ready } = usePredictExecution({
    session,
    selected,
    owner,
    chainId,
    tradeWallet: predicted,
    funding,
    native: token.id === "native",
  });
  const stage = progress?.stage ?? "idle";
  const isRunning = stage === "quoting" || stage === "signing" || stage === "confirming";

  useEffect(() => {
    if (stage !== "complete") return;
    driver?.reset();
    onSuccess();
  }, [stage, driver, onSuccess]);

  // a transaction that may still mine stays stored, so the next popup recovers it instead of signing again
  const pendingHash = progress?.pendingHash;

  const close = () => {
    if (stage === "halted" && !pendingHash) driver?.reset();
    onClose();
  };

  const predict = () => {
    if (stage === "halted" && progress?.failure?.retryable) {
      driver?.retry();
      return;
    }
    if (stage === "halted" && !pendingHash) driver?.reset();
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
        isRunning ? undefined : notice({ owner, onRightChain: chainId === DEFAULT_CHAIN_ID, ready })
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

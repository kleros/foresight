"use client";

import { useEffect, useState } from "react";

import type { Address } from "viem";
import { useAccount } from "wagmi";

import type { PayTokenChoice } from "@/features/predict/components/PredictAmountSection";
import { PredictDialog } from "@/features/predict/components/PredictDialog";
import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import type { PayToken, SelectedEstimate } from "@/features/predict/types";
import { expectedSplit, roundToDisplay } from "@/features/predict/utils/funding";
import { fundsToAdd, predictSteps, type FundsToAdd } from "@/features/predict/utils/predictSteps";
import type { SessionDetail } from "@/features/sessions/types";
import { optionNounSingular } from "@/features/sessions/utils/optionNoun";
import { useExecutor } from "@/features/trade-executor/api/getExecutor";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import type { PlacedPrediction } from "./PredictSuccessView";
import { toPredictOptions, toSavedEstimates } from "./toPredictOptions";
import { useHasPredicted } from "./useHasPredicted";
import { usePredictExecution } from "./usePredictExecution";
import { usePredictFunding } from "./usePredictFunding";
import { usePricePreview } from "./usePricePreview";

interface PredictRunnerProps {
  session: SessionDetail;
  selected: SelectedEstimate[];
  onClose: () => void;
  /** Options the run left out for lack of a route, and what it placed; the run is reset by the time this is called. */
  onSuccess: (leftOut: Address[], placed: PlacedPrediction) => void;
}

const NATIVE: PayTokenChoice = { id: "native", symbol: "xDAI", decimals: 18 };

/**
 * Everything behind the predict button, mounted only once it is pressed: the wallet, the run and
 * the popup. Kept out of the page so the route does not carry the orchestrator and the quoter.
 */
export function PredictRunner({ session, selected, onClose, onSuccess }: PredictRunnerProps) {
  const { address: owner, chainId } = useAccount();

  const [amount, setAmount] = useState<bigint>();
  const [picked, setPicked] = useState<PayToken>();
  const [useCredits, setUseCredits] = useState(true);
  // removed in this popup; cleared from the page only once Predict is pressed
  const [removed, setRemoved] = useState<string[]>([]);
  // what the steps say is being added, held from the press so a refreshed balance cannot rewrite it
  const [frozenToAdd, setFrozenToAdd] = useState<FundsToAdd>();

  const clearEstimate = useEstimateStore((state) => state.clearEstimate);
  const executor = useExecutor();

  const predicted = executor.data?.predicted;
  const { collateralToken } = session;

  const collateral = { symbol: session.collateralSymbol ?? "sDAI", decimals: session.collateralDecimals ?? 18 };
  const {
    funding,
    credits,
    token: tokenId,
    available,
    canPayNative,
  } = usePredictFunding({
    owner,
    tradeWallet: predicted,
    collateral: collateralToken,
    token: picked,
    amount: amount ?? 0n,
    useCredits,
  });
  // the default is chosen once, so a balance refresh cannot switch the token under a typed amount
  if (picked === undefined && tokenId !== undefined) setPicked(tokenId);
  const isFirstPrediction = !useHasPredicted(predicted, session);

  const tokens: PayTokenChoice[] = [{ id: "collateral", ...collateral }, ...(canPayNative ? [NATIVE] : [])];
  const token = tokens.find((choice) => choice.id === tokenId) ?? tokens[0]!;
  const kept = selected.filter((estimate) => !removed.includes(estimate.scale.market));

  const preview = usePricePreview({
    session,
    selected: kept,
    tradeWallet: predicted,
    collateralIn: funding ? expectedSplit(funding) : 0n,
  });

  const { driver, progress, ready } = usePredictExecution({
    session,
    selected: kept,
    owner,
    chainId,
    tradeWallet: predicted,
    funding,
    native: token.id === "native",
  });
  const stage = progress?.stage ?? "idle";
  const recovered = progress?.recovered;
  const isRunning = stage === "quoting" || stage === "signing" || stage === "confirming";
  const retryable = stage === "halted" && Boolean(progress?.failure?.retryable);

  useEffect(() => {
    driver?.recover();
  }, [driver]);

  // a recovered run placed its stored options and collateral, not what this popup's form holds;
  // an estimate with no tradeable option never enters a run
  const placedCount = recovered ? recovered.options.length : toPredictOptions(session, kept).length;
  // a recovered run's collateral leaves its credits apart, which it spent one sDAI each
  const placedAmount = recovered
    ? recovered.collateralIn + (recovered.creditsToSpend > 0n ? recovered.creditsToSpend : 0n)
    : amount;
  const placedToken = recovered ? collateral : token;
  const { symbol: placedSymbol, decimals: placedDecimals } = placedToken;

  useEffect(() => {
    if (stage !== "complete") return;
    const left = progress?.leftOut ?? [];
    driver?.reset();
    onSuccess(left, {
      estimates: placedCount - left.length,
      amount: placedAmount || undefined,
      symbol: placedSymbol,
      decimals: placedDecimals,
    });
  }, [stage, driver, onSuccess, progress?.leftOut, placedCount, placedAmount, placedSymbol, placedDecimals]);

  // a transaction that may still mine stays stored, so the next popup recovers it instead of signing again
  const pendingHash = progress?.pendingHash;
  // once money has moved, or may have, the run's snapshot is what gets signed, so the form locks to it
  const canRetry = recovered
    ? stage === "review" || retryable
    : retryable && (Boolean(pendingHash) || Boolean(progress?.moneyMoved));

  const close = () => {
    if (stage === "halted" && !pendingHash) driver?.reset();
    onClose();
  };

  const predict = () => {
    if (stage === "review") {
      driver?.resume();
      return;
    }
    if (canRetry) {
      driver?.retry();
      return;
    }
    // a stored run is resumed or closed, never replaced by the form behind it
    if (recovered) return;
    if (stage === "halted" && !pendingHash) driver?.reset();
    for (const market of removed) clearEstimate(session.parentMarket, market);
    setFrozenToAdd(fundsToAdd(funding, token, collateral));
    driver?.start();
  };

  // an amount over the balance cannot be predicted, so nothing is named as being added for it
  const overBalance = funding !== null && amount !== undefined && amount > funding.available;
  const runToken: PayTokenChoice = recovered?.depositNative ? NATIVE : { id: "collateral", ...collateral };
  const steps = predictSteps({
    wallet: predicted ? { address: predicted, deployed: Boolean(executor.data?.deployed) } : null,
    ...(recovered
      ? {
          toAdd: recovered.deposit,
          symbol: runToken.symbol,
          decimals: runToken.decimals,
          ...(recovered.creditsFromEoa > 0n ? { credits: recovered.creditsFromEoa } : {}),
        }
      : // held only while the form is locked to the run; otherwise the form is what the next press signs
        ((isRunning || canRetry) && frozenToAdd) || fundsToAdd(overBalance ? null : funding, token, collateral)),
    progress,
  });

  return (
    <PredictDialog
      isOpen
      onClose={close}
      selected={recovered ? toSavedEstimates(session, recovered.options) : kept}
      onRemove={(market) => setRemoved((markets) => [...markets, market])}
      preview={recovered ? undefined : preview}
      amount={amount}
      onAmountChange={setAmount}
      tokens={tokens}
      token={token}
      onTokenChange={(next) => {
        // both pay tokens have 18 decimals, so the typed number carries over as is
        const max = available(next);
        const cap = max === undefined ? undefined : roundToDisplay(max, token.decimals);
        setPicked(next);
        if (amount !== undefined && cap !== undefined && amount > cap) setAmount(cap);
      }}
      funding={funding}
      collateral={collateral}
      credits={
        credits.state === "none" ? undefined : { offer: credits, isUsing: useCredits, onUsingChange: setUseCredits }
      }
      optionNoun={optionNounSingular(session.itemName)}
      isFirstPrediction={isFirstPrediction}
      isDisconnected={owner === undefined}
      steps={steps}
      leftOut={progress?.leftOut.length ?? 0}
      isRunning={isRunning}
      canRetry={canRetry}
      isPending={Boolean(pendingHash)}
      recovered={recovered && { deposit: recovered.deposit, token: runToken }}
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
  if (!args.owner) return "Connect a wallet to predict.";
  if (!args.onRightChain) return "Switch to Gnosis to predict.";
  if (!args.ready) return "This session cannot be traded yet.";
  return undefined;
}

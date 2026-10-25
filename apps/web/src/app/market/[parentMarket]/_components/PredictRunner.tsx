"use client";

import { useEffect, useMemo, useState } from "react";

import type { Address } from "viem";
import { useAccount } from "wagmi";

import type { PayTokenChoice } from "@/features/predict/components/PredictAmountSection";
import { PredictDialog } from "@/features/predict/components/PredictDialog";
import type { PriceMove } from "@/features/predict/components/PredictList";
import { tradeWalletShare } from "@/features/predict/flow/plan";
import { STEP_ID } from "@/features/predict/flow/stepIds";
import type { HeldTo, ShownPlans, ShownQuotes } from "@/features/predict/run/types";
import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import { useSlippageStore } from "@/features/predict/stores/slippageStore";
import type { PayToken, SelectedEstimate } from "@/features/predict/types";
import { roundToDisplay, shownSplit } from "@/features/predict/utils/funding";
import { withQuotes } from "@/features/predict/utils/plan";
import {
  CREDITS_UNAVAILABLE,
  fundsToAdd,
  predictSteps,
  SESSION_CLOSED,
  type FundsToAdd,
} from "@/features/predict/utils/predictSteps";
import { resolveSlippage } from "@/features/predict/utils/slippage";
import type { SessionDetail, SessionStatus } from "@/features/sessions/types";
import { optionNounSingular } from "@/features/sessions/utils/optionNoun";
import { useExecutor } from "@/features/trade-executor/api/getExecutor";

import { TradeWalletMismatchError } from "@/lib/trade-executor/executor";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import type { PlacedPrediction } from "./PredictSuccessView";
import { toPredictOptions, toSavedEstimates } from "./toPredictOptions";
import { useCreditsSwapPreview } from "./useCreditsSwapPreview";
import { useHasPredicted } from "./useHasPredicted";
import { usePredictExecution } from "./usePredictExecution";
import { usePredictFunding } from "./usePredictFunding";
import { toPriceMove, usePricePreview } from "./usePricePreview";

interface PredictRunnerProps {
  session: SessionDetail;
  /** The page's status, which flips to closed at the close; the driver checks the chain's clock before signing. */
  status: SessionStatus;
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
export function PredictRunner({ session, status, selected, onClose, onSuccess }: PredictRunnerProps) {
  const isClosed = status === "closed";
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

  const slippageSettings = useSlippageStore((state) => state.settings);
  const setSlippage = useSlippageStore((state) => state.setSlippage);
  const slippage = resolveSlippage(slippageSettings);
  const creditsIn = funding?.creditsIn ?? 0n;
  const { preview: creditsQuote, failed: creditsFailed } = useCreditsSwapPreview({
    sessionId: session.id,
    collateral: collateralToken,
    tradeWallet: predicted,
    credits: creditsIn,
    creditsBps: slippage.creditsBps,
  });
  const preview = usePricePreview({
    session,
    selected: kept,
    tradeWallet: predicted,
    collateralIn: funding ? shownSplit(funding, creditsQuote?.minted) : undefined,
    slippageBps: slippage.tradeBps,
  });

  const { driver, progress, ready } = usePredictExecution({
    session,
    selected: kept,
    owner,
    chainId,
    tradeWallet: predicted,
    funding,
    native: token.id === "native",
    slippage,
  });
  const stage = progress?.stage ?? "idle";
  const recovered = progress?.recovered;
  const isRunning = stage === "quoting" || stage === "signing" || stage === "confirming";
  const retryable = stage === "halted" && Boolean(progress?.failure?.retryable);
  const moved = stage === "moved" ? progress?.moved : undefined;
  const held = progress?.held;

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

  const runToken: PayTokenChoice = recovered?.depositNative ? NATIVE : { id: "collateral", ...collateral };
  // what a recovered run's funds step adds, from its snapshot rather than the form
  const { symbol: runSymbol, decimals: runDecimals } = runToken;
  const recoveredFunds = useMemo<FundsToAdd | undefined>(
    () =>
      recovered && {
        toAdd: recovered.deposit,
        symbol: runSymbol,
        decimals: runDecimals,
        ...(recovered.creditsFromEoa > 0n ? { credits: recovered.creditsFromEoa } : {}),
      },
    [recovered, runSymbol, runDecimals],
  );
  const placedFunds = recoveredFunds ?? frozenToAdd;
  const placedSteps = progress?.steps;

  useEffect(() => {
    if (stage !== "complete") return;
    const left = progress?.leftOut ?? [];
    // read before the reset, which empties the run's steps
    const steps = (placedSteps ?? []).map(({ id, hash }) => (hash ? { id, hash } : { id }));
    driver?.reset();
    onSuccess(left, {
      estimates: placedCount - left.length,
      amount: placedAmount || undefined,
      symbol: placedSymbol,
      decimals: placedDecimals,
      steps,
      ...(placedFunds ? { funds: placedFunds } : {}),
      ...(predicted ? { wallet: predicted } : {}),
    });
  }, [
    stage,
    driver,
    onSuccess,
    progress?.leftOut,
    placedCount,
    placedAmount,
    placedSymbol,
    placedDecimals,
    placedSteps,
    placedFunds,
    predicted,
  ]);

  // a transaction that may still mine stays stored, so the next popup recovers it instead of signing again
  const pendingHash = progress?.pendingHash;
  // once money has moved, or may have, the run's snapshot is what gets signed, so the form locks to it
  const canRetry = recovered
    ? stage === "review" || retryable
    : retryable &&
      (Boolean(pendingHash) ||
        Boolean(progress?.moneyMoved) ||
        Boolean(progress?.unanswered) ||
        progress?.failure?.reason === "pending");

  const close = () => {
    if ((stage === "halted" && !pendingHash) || stage === "moved") driver?.reset();
    onClose();
  };

  /** Each option's move as `plans` give it; an option without a plan there keeps the live preview's. */
  const movesFrom = (plans: ShownPlans, was?: ShownPlans, changed: readonly string[] = []) => {
    const moves: Record<string, PriceMove> = { ...preview.moves };
    for (const [key, trades] of Object.entries(plans)) {
      const scale = session.options.find((option) => option.market.toLowerCase() === key);
      if (!scale) continue;
      const before = changed.includes(key) ? was?.[key] : undefined;
      const beforeMove = before && toPriceMove(before, scale, 0n);
      moves[key] = {
        ...toPriceMove(trades, scale, preview.held[key] ?? 0n),
        ...(beforeMove ? { was: { from: beforeMove.from, to: beforeMove.to } } : {}),
      };
    }
    return moves;
  };
  /** `plans`, each with its legs as `quotes` give them where it has quotes. */
  const quotedPlans = (plans: ShownPlans, quotes: ShownQuotes | undefined): ShownPlans =>
    Object.fromEntries(
      Object.entries(plans).map(([key, plan]) => [key, quotes?.[key] ? withQuotes(plan, quotes[key]) : plan]),
    );
  // while a run is held to what it was shown, that is what Details shows
  const isHeldRun = held !== undefined && (isRunning || canRetry);
  // the first batch carries the credits swap
  const creditsLanded = progress?.steps.some((step) => step.id === STEP_ID.predict(1) && step.state === "success");
  const shownMoves = moved
    ? movesFrom(
        quotedPlans(moved.plans, moved.quotes),
        held && quotedPlans(held.plans, held.quotes),
        moved.markets.map((market) => market.toLowerCase()),
      )
    : isHeldRun
      ? movesFrom(quotedPlans(held.plans, held.quotes))
      : preview.moves;
  const shownCredits = moved?.credits ?? (isHeldRun ? held.credits : creditsQuote);
  const creditsWas = moved?.credits ? held?.credits : undefined;

  const predict = () => {
    if (isClosed) return;
    if (moved) {
      driver?.confirm();
      return;
    }
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
    const heldTo: HeldTo = {
      plans: preview.plans,
      ...(creditsIn > 0n && creditsQuote ? { credits: creditsQuote } : {}),
    };
    driver?.start(heldTo);
  };

  // an amount over the balance cannot be predicted, so nothing is named as being added for it
  const overBalance = funding !== null && amount !== undefined && amount > funding.available;
  const steps = predictSteps({
    wallet: predicted ? { address: predicted, deployed: Boolean(executor.data?.deployed) } : null,
    ...(recoveredFunds ??
      // held while the form is locked to the run, moved included; otherwise the form is what the next press signs
      (((isRunning || canRetry || moved) && frozenToAdd) ||
        fundsToAdd(overBalance ? null : funding, token, collateral))),
    progress,
  });

  // the form's own prices and credits quote matter only to a press that starts a new run
  const startsNew = !moved && !canRetry && !recovered && !pendingHash;
  // once a run is going its own state is the story, not what the wallet is doing now
  const shownNotice = isRunning
    ? undefined
    : notice({
        isClosed,
        owner,
        onRightChain: chainId === DEFAULT_CHAIN_ID,
        walletMismatch: executor.error instanceof TradeWalletMismatchError ? executor.error.message : undefined,
        ready,
        creditsFailed: creditsFailed && startsNew,
        pricesFailed: preview.failed && startsNew,
        pricesFailedAgain: preview.failedAgain,
      });

  return (
    <PredictDialog
      isOpen
      onClose={close}
      selected={recovered ? toSavedEstimates(session, recovered.options) : kept}
      onRemove={(market) => setRemoved((markets) => [...markets, market])}
      preview={recovered ? undefined : shownMoves}
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
      canClose={stage === "confirming" && Boolean(progress?.sentHash)}
      canRetry={canRetry}
      isPending={Boolean(pendingHash) || (stage === "halted" && Boolean(progress?.unanswered))}
      recovered={
        recovered && {
          deposit: recovered.deposit,
          token: runToken,
          ...(recovered.depositNative && recovered.deposit > 0n
            ? { deposited: recovered.collateralIn - tradeWalletShare(recovered) }
            : {}),
          slippage: {
            tradeBps: recovered.slippage.tradeBps,
            ...(recovered.creditsToSpend > 0n && !creditsLanded ? { creditsBps: recovered.slippage.creditsBps } : {}),
          },
        }
      }
      notice={shownNotice}
      slippage={{ settings: slippageSettings, onChange: setSlippage }}
      creditsSwap={
        shownCredits && (creditsIn > 0n || moved?.credits || isHeldRun)
          ? {
              credits: creditsIn,
              preview: shownCredits,
              ...(creditsWas ? { was: creditsWas } : {}),
              ...(isHeldRun && creditsLanded ? { landed: true as const } : {}),
            }
          : undefined
      }
      moved={
        moved && {
          markets: moved.markets.length,
          credits: moved.credits !== undefined,
          ...(moved.bySlippage ? { bySlippage: true as const } : {}),
        }
      }
      pricesReady={preview.ready}
      // reset refuses a run holding a send, so Back would do nothing
      onBack={moved && !progress?.moneyMoved && !progress?.unanswered ? () => driver?.reset() : undefined}
      // only where the prices are what stands in the way
      onRetryPrices={shownNotice === PRICES_FAILED || shownNotice === PRICES_FAILED_AGAIN ? preview.retry : undefined}
      isRetryingPrices={preview.retrying}
      onPredict={predict}
    />
  );
}

const PRICES_FAILED = "Prices could not be read.";
const PRICES_FAILED_AGAIN = "Prices still could not be read.";

/** Why this prediction cannot be made, in the words of the thing the visitor has to do. */
function notice(args: {
  isClosed: boolean;
  owner?: string;
  onRightChain: boolean;
  /** Said where the node's trade wallet is not the one derived for the owner. */
  walletMismatch?: string;
  ready: boolean;
  creditsFailed: boolean;
  pricesFailed: boolean;
  /** A read after a failed one failed too. */
  pricesFailedAgain: boolean;
}): string | undefined {
  if (args.isClosed) return SESSION_CLOSED;
  if (!args.owner) return "Connect a wallet to predict.";
  if (!args.onRightChain) return "Switch to Gnosis to predict.";
  if (args.walletMismatch) return args.walletMismatch;
  if (!args.ready) return "This session cannot be traded yet.";
  if (args.pricesFailed) return args.pricesFailedAgain ? PRICES_FAILED_AGAIN : PRICES_FAILED;
  if (args.creditsFailed) return CREDITS_UNAVAILABLE;
  return undefined;
}

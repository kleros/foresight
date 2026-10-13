"use client";

import { Button, Modal } from "@kleros/ui-components-library";
import clsx from "clsx";
import { formatUnits } from "viem";

import InfoCard from "@/components/ui/InfoCard";
import { ScrollFade } from "@/components/ui/ScrollFade";

import type { PayToken } from "../types";
import { PredictAmountSection, type PayTokenChoice } from "./PredictAmountSection";
import { PredictList, type ListedEstimate, type PriceMove } from "./PredictList";
import { PredictStepsTimeline } from "./PredictStepsTimeline";
import type { Funding } from "../utils/funding";
import type { PredictSteps } from "../utils/predictSteps";

interface PredictDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selected: ListedEstimate[];
  onRemove: (market: string) => void;
  /** Where each listed option's market would move, keyed by lower-case market. */
  preview?: Record<string, PriceMove>;
  amount: bigint | undefined;
  onAmountChange: (amount: bigint | undefined) => void;
  tokens: PayTokenChoice[];
  token: PayTokenChoice;
  onTokenChange: (token: PayToken) => void;
  /** Null while the balances are still being read. */
  funding: Funding | null;
  collateral: { symbol: string; decimals: number };
  isFirstPrediction: boolean;
  isDisconnected?: boolean;
  steps: PredictSteps;
  /** Estimates the run could not find a route for and left out. */
  skipped: number;
  /** A run is between its first signature and its end. */
  isRunning: boolean;
  /** A stopped run can pick up where it stopped, with the amount and estimates it was started with. */
  canRetry: boolean;
  /** A stored run under review: its own deposit replaces the amount form, and Resume replaces Predict. */
  recovered?: { deposit: bigint; symbol: string; decimals: number };
  /** What the visitor has to do before this prediction can be made, if anything. */
  notice?: string;
  /** Starts a run, or picks a stopped one up again. */
  onPredict: () => void;
}

/** Futarchy's predict popup: the estimates, the amount behind them, and the steps that place them. */
export function PredictDialog({
  isOpen,
  onClose,
  selected,
  onRemove,
  preview,
  amount,
  onAmountChange,
  tokens,
  token,
  onTokenChange,
  funding,
  collateral,
  isFirstPrediction,
  isDisconnected,
  steps,
  skipped,
  isRunning,
  canRetry,
  recovered,
  notice,
  onPredict,
}: PredictDialogProps) {
  const isLocked = isRunning || canRetry || recovered !== undefined;
  const tooMuch = funding !== null && amount !== undefined && amount > funding.available;
  // with nothing held, an empty amount has nothing to trade with
  const nothingToTrade = isFirstPrediction && (funding?.collateralIn ?? 0n) === 0n;

  return (
    <Modal
      ariaLabel="Predict"
      isOpen={isOpen}
      // leaving part way through would abandon a run whose transactions are already on chain
      isDismissable={!isRunning}
      onOpenChange={(open) => (open || isRunning ? undefined : onClose())}
      className={clsx(
        "fixed top-18 left-1/2 -translate-x-1/2 transform md:top-20",
        "h-auto max-h-[calc(100dvh-5rem)] w-max md:max-h-[calc(100dvh-7rem)]",
        "max-md:w-[calc(100vw-2rem)] max-md:max-w-sm",
        "flex p-3 pb-0! md:px-10 md:py-8",
        "rounded-fs border-fs-border bg-fs-surface border",
      )}
    >
      <div className="flex min-h-0 w-full flex-col items-center">
        <PredictList selected={selected} onRemove={onRemove} isReadOnly={isLocked} preview={preview} />
        <ScrollFade className="min-h-32 w-full">
          {recovered ? (
            <div className="mb-4 flex flex-col items-center gap-1 text-center">
              <p className="text-fs-text-secondary text-sm">
                This prediction did not finish. Resuming it uses the amount and estimates it started with.
              </p>
              <p className="text-fs-text-primary text-base font-semibold">
                Deposit: {formatUnits(recovered.deposit, recovered.decimals)} {recovered.symbol}
              </p>
            </div>
          ) : (
            <PredictAmountSection
              amount={amount}
              onAmountChange={onAmountChange}
              tokens={tokens}
              token={token}
              onTokenChange={onTokenChange}
              funding={funding}
              collateral={collateral}
              isFirstPrediction={isFirstPrediction}
              isReadOnly={isLocked}
              isDisconnected={isDisconnected}
            />
          )}
          <PredictStepsTimeline steps={steps} />
          <p className="text-fs-text-secondary text-center text-sm">
            Trading stops at your estimate, so no market moves past it. The average price you pay or receive includes
            the pool fee, so you may pay more or receive less than your estimate.
          </p>
          {skipped > 0 ? (
            <p className="text-fs-text-secondary text-center text-sm">
              {skipped} of your estimates could not be traded right now and were left out.
            </p>
          ) : null}
        </ScrollFade>

        <div className="bg-fs-surface sticky bottom-0 flex flex-col items-center gap-3 py-2 md:py-4">
          {notice !== undefined ? <InfoCard className="text-sm" msg={notice} /> : null}
          <div className="flex flex-wrap gap-3.5">
            <Button text="Cancel" variant="secondary" onPress={onClose} isDisabled={isRunning} />
            <Button
              text={recovered ? "Resume" : canRetry ? "Try the rest" : "Predict"}
              onPress={onPredict}
              isDisabled={
                isRunning ||
                notice !== undefined ||
                (!canRetry &&
                  (recovered !== undefined || selected.length === 0 || funding === null || tooMuch || nothingToTrade))
              }
              isLoading={isRunning}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}

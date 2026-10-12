"use client";

import { Button, Modal } from "@kleros/ui-components-library";
import clsx from "clsx";

import InfoCard from "@/components/ui/InfoCard";
import { ScrollFade } from "@/components/ui/ScrollFade";

import type { PayToken, SelectedEstimate } from "../types";
import { PredictAmountSection, type PayTokenChoice } from "./PredictAmountSection";
import { PredictList } from "./PredictList";
import { PredictStepsTimeline } from "./PredictStepsTimeline";
import type { Funding } from "../utils/funding";
import type { PredictSteps } from "../utils/predictSteps";

interface PredictDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selected: SelectedEstimate[];
  onRemove: (market: string) => void;
  amount: bigint | undefined;
  onAmountChange: (amount: bigint | undefined) => void;
  tokens: PayTokenChoice[];
  token: PayTokenChoice;
  onTokenChange: (token: PayToken) => void;
  /** Null while the balances are still being read. */
  funding: Funding | null;
  collateral: { symbol: string; decimals: number };
  isFirstPrediction: boolean;
  steps: PredictSteps;
  /** Estimates the run could not find a route for and left out. */
  skipped: number;
  /** A run is between its first signature and its end. */
  isRunning: boolean;
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
  amount,
  onAmountChange,
  tokens,
  token,
  onTokenChange,
  funding,
  collateral,
  isFirstPrediction,
  steps,
  skipped,
  isRunning,
  notice,
  onPredict,
}: PredictDialogProps) {
  const tooMuch = funding !== null && amount !== undefined && amount > funding.available;
  // with nothing held, an empty amount has nothing to trade with
  const nothingToTrade = isFirstPrediction && (funding?.collateralIn ?? 0n) === 0n;

  return (
    <Modal
      isOpen={isOpen}
      // leaving part way through would abandon a run whose transactions are already on chain
      isDismissable={!isRunning}
      onOpenChange={(open) => (open || isRunning ? undefined : onClose())}
      className={clsx(
        "fixed top-[5vh] left-1/2 -translate-x-1/2 transform",
        "h-auto max-h-[90vh] w-max max-md:w-full max-md:max-w-sm",
        "flex p-4 pb-0! md:px-10 md:py-8",
        "rounded-fs border-fs-border bg-fs-surface border",
      )}
    >
      <div className="flex min-h-0 w-full flex-col items-center">
        <PredictList selected={selected} onRemove={onRemove} isReadOnly={isRunning} />
        <ScrollFade className="min-h-32 w-full">
          <PredictAmountSection
            amount={amount}
            onAmountChange={onAmountChange}
            tokens={tokens}
            token={token}
            onTokenChange={onTokenChange}
            funding={funding}
            collateral={collateral}
            isFirstPrediction={isFirstPrediction}
            isReadOnly={isRunning}
          />
          <PredictStepsTimeline steps={steps} />
          <p className="text-fs-text-secondary text-center text-sm">
            Trading stops at your estimate, so no market moves past it. The average price you pay or receive includes
            the pool fee.
          </p>
          {skipped > 0 ? (
            <p className="text-fs-text-secondary text-center text-sm">
              {skipped} of your estimates could not be traded right now and were left out.
            </p>
          ) : null}
        </ScrollFade>

        <div className="bg-fs-surface sticky bottom-0 flex flex-col items-center gap-3 py-4">
          {notice !== undefined ? <InfoCard className="text-sm" msg={notice} /> : null}
          <div className="flex flex-wrap gap-3.5">
            <Button text="Cancel" variant="secondary" onPress={onClose} isDisabled={isRunning} />
            <Button
              text="Predict"
              onPress={onPredict}
              isDisabled={
                isRunning ||
                notice !== undefined ||
                selected.length === 0 ||
                funding === null ||
                tooMuch ||
                nothingToTrade
              }
              isLoading={isRunning}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}

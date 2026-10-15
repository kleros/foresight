"use client";

import { useState } from "react";

import { Button, Modal } from "@kleros/ui-components-library";
import clsx from "clsx";

import { ScrollFade } from "@/components/ui/ScrollFade";

import type { PayToken } from "../types";
import { PredictAmountSection, type PayTokenChoice } from "./PredictAmountSection";
import { PredictList, type ListedEstimate, type PriceMove } from "./PredictList";
import { PredictSpineNode } from "./PredictSpineNode";
import { PredictStepsTimeline } from "./PredictStepsTimeline";
import type { Funding } from "../utils/funding";
import { statusLine, type PredictSteps, type StatusLine } from "../utils/predictSteps";

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
  /** The stopped run sent a transaction whose outcome is unknown; pressing on checks it first. */
  isPending?: boolean;
  /** A stored run under review: its own deposit fills the locked amount form, and Resume replaces Predict. */
  recovered?: { deposit: bigint; token: PayTokenChoice };
  /** What the visitor has to do before this prediction can be made, if anything. */
  notice?: string;
  /** Starts a run, or picks a stopped one up again. */
  onPredict: () => void;
}

const STATUS_TONE: Record<StatusLine["tone"], string> = {
  neutral: "text-fs-text-secondary",
  warning: "text-fs-tone-warning-text",
  error: "text-fs-tone-error-text",
};

/** What `value` was when `locked` last turned on, held until it turns off. */
function useHeldWhile<T>(value: T, locked: boolean): T {
  const [held, setHeld] = useState<{ value: T } | null>(locked ? { value } : null);
  if (locked && !held) setHeld({ value });
  if (!locked && held) setHeld(null);
  return locked && held ? held.value : value;
}

/**
 * Futarchy's predict popup as one spine: the estimates, the amount, then the run's steps. Every region
 * has a fixed height, so the dialog keeps one size from the first look through signing, a failure and the end of the run.
 */
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
  isPending = false,
  recovered,
  notice,
  onPredict,
}: PredictDialogProps) {
  const isLocked = isRunning || canRetry || recovered !== undefined;
  const tooMuch = funding !== null && amount !== undefined && amount > funding.available;
  // with nothing held, an empty amount has nothing to trade with
  const nothingToTrade = isFirstPrediction && (funding?.collateralIn ?? 0n) === 0n;
  const status = statusLine({ steps, notice, skipped });
  const runToken = recovered?.token;
  // a refreshed balance or re-priced preview would change what the visitor is reading mid-run
  const shownFunding = useHeldWhile(funding, isLocked);
  const shownPreview = useHeldWhile(preview, isLocked);

  return (
    <Modal
      ariaLabel="Predict"
      isOpen={isOpen}
      // leaving part way through would abandon a run whose transactions are already on chain
      isDismissable={!isRunning}
      onOpenChange={(open) => (open || isRunning ? undefined : onClose())}
      className={clsx(
        "fixed top-18 left-1/2 -translate-x-1/2 transform md:top-20",
        "h-auto max-h-[calc(100dvh-5rem)] md:max-h-[calc(100dvh-7rem)]",
        "w-[calc(100vw-2rem)] max-w-[560px]",
        "flex px-4 pt-4 pb-0! md:px-10 md:pt-6",
        "rounded-fs border-fs-border bg-fs-surface border",
      )}
    >
      <div className="flex min-h-0 w-full flex-col">
        <h2 className="text-fs-text-primary mb-2 text-xl font-semibold md:text-2xl">Predict</h2>
        {/* its line runs on through the body's top padding, which keeps the amount's 44px Max inside the scroll area */}
        <div className="shrink-0 [&_.spine-line]:-mb-2.5! [&_[data-spine-content]]:pb-0!">
          <PredictSpineNode
            title={`${selected.length} ${selected.length === 1 ? "estimate" : "estimates"}`}
            done={isLocked}
          >
            {/* over four rows three and a half show, three on a phone over three: the cut row is the cue */}
            <ScrollFade
              className={clsx("w-full", selected.length > 4 && "max-h-28", selected.length > 3 && "max-sm:max-h-27")}
            >
              <PredictList selected={selected} onRemove={onRemove} isReadOnly={isLocked} preview={shownPreview} />
            </ScrollFade>
          </PredictSpineNode>
        </div>
        <ScrollFade className="min-h-32 w-full" cue="More below">
          <div data-testid="predict-body" className="pt-3">
            <PredictAmountSection
              amount={recovered ? recovered.deposit : amount}
              onAmountChange={onAmountChange}
              tokens={runToken ? [runToken] : tokens}
              token={runToken ?? token}
              onTokenChange={onTokenChange}
              funding={shownFunding}
              collateral={collateral}
              isFirstPrediction={isFirstPrediction}
              isReadOnly={isLocked}
              isDisconnected={isDisconnected}
              note={recovered ? "Locked to the amount this prediction started with." : undefined}
            />
            <PredictStepsTimeline steps={steps} />
          </div>
        </ScrollFade>

        {/* outside the scroll area, so the reason a run stopped is never under the fold; two lines, held empty or not */}
        <p
          role="status"
          aria-live="polite"
          className={clsx(
            "type-label flex h-10 shrink-0 items-center justify-center px-2 text-center text-pretty",
            status && STATUS_TONE[status.tone],
          )}
        >
          {status ? (
            <span key={status.text} className={clsx(status.tone === "error" && "fs-enter")}>
              {status.text}
            </span>
          ) : null}
        </p>

        <div className="bg-fs-surface sticky bottom-0 flex justify-center gap-3.5 py-4 md:pb-6 short:py-3">
          <Button text="Cancel" variant="secondary" onPress={onClose} isDisabled={isRunning} />
          <Button
            className="min-w-[170px]"
            text={recovered ? "Resume" : isPending ? "Check again" : canRetry ? "Try the rest" : "Predict"}
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
    </Modal>
  );
}

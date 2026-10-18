"use client";

import { useEffect, useRef, useState } from "react";

import { Modal } from "@kleros/ui-components-library";
import clsx from "clsx";

import LightButton from "@/components/ui/LightButton";
import { ScrollFade } from "@/components/ui/ScrollFade";

import CloseIcon from "@/assets/svg/close.svg";

import type { PayToken } from "../types";
import { PredictAmountSection, type PayTokenChoice } from "./PredictAmountSection";
import { PredictButton } from "./PredictButton";
import type { CreditsChoice } from "./PredictCreditsLine";
import { PredictList, type ListedEstimate, type PriceMove } from "./PredictList";
import { PredictStepsTimeline } from "./PredictStepsTimeline";
import { PredictSummary } from "./PredictSummary";
import type { Funding } from "../utils/funding";
import { CHECKING_PRICES, statusLine, type PredictSteps, type StatusLine } from "../utils/predictSteps";

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
  /** The visitor's credits and their tick; absent where they hold none. */
  credits?: CreditsChoice;
  /** One option, as the session names it: `city`. */
  optionNoun: string;
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
  neutral: "text-fs-popup-text-2",
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

/** The busy button for a running step that is not waiting on the wallet. */
const BUSY_COPY: Record<PredictSteps["rows"][number]["key"], string> = {
  wallet: "Setting up…",
  funds: "Adding funds…",
  predict: "Predicting…",
};

/** What the running step is waiting on, for the busy button: `Confirm in your wallet`, without a batch count. */
function busyLabel(steps: PredictSteps): string {
  const running = steps.rows.find((row) => row.view === "running");
  return running?.subtitle.split(" · ").at(-1) || BUSY_COPY[running?.key ?? "predict"];
}

/**
 * Futarchy's predict popup: the estimates, the amount, a summary of the markets it moves, then the run's steps.
 * Every region has a fixed height, so the dialog keeps one size from the first look through signing, a failure
 * and the end of the run; only the summary, opened by the visitor, adds to it.
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
  credits,
  optionNoun,
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
  const isPricing = steps.pricing === true;
  const runToken = recovered?.token;
  // a refreshed balance or re-priced preview would change what the visitor is reading mid-run
  const shownFunding = useHeldWhile(funding, isLocked);
  const shownPreview = useHeldWhile(preview, isLocked);
  // the visitor's own choice, so no run state opens or closes it
  const [summaryOpen, setSummaryOpen] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const statusText = status?.text;
  // where the whole popup scrolls, the status line sits under the fold; during a run, the timeline's scroll to its step rules
  useEffect(() => {
    if (!isOpen || statusText === undefined || isRunning) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const frame = requestAnimationFrame(() =>
      statusRef.current?.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [isOpen, statusText, isRunning]);

  return (
    <Modal
      ariaLabel="Predict"
      isOpen={isOpen}
      // leaving part way through would abandon a run whose transactions are already on chain
      isDismissable={!isRunning}
      onOpenChange={(open) => (open || isRunning ? undefined : onClose())}
      className={clsx(
        "fixed top-18 left-1/2 -translate-x-1/2 transform",
        "h-auto max-h-[calc(100dvh-5rem)] md:max-h-[calc(100dvh-5.5rem)]",
        "w-[calc(100vw-2rem)] max-w-[480px]",
        "flex px-4 pt-4 pb-0! md:px-5 md:pt-5",
        "fs-aurora rounded-fs-popup bg-fs-surface border border-(--fs-popup-edge) shadow-(--fs-popup-shadow)",
      )}
    >
      {/* on a phone on its side the whole popup scrolls between its sticky 40px header and its sticky button;
          it reaches 12px into the dialog's right padding for the close button's target, 4px into the left for Predict's ring */}
      <div
        className={clsx(
          "flex min-h-0 w-full flex-col",
          "landscape-phone:overflow-y-auto landscape-phone:scroll-pt-10 landscape-phone:scroll-pb-16",
          "short:landscape-phone:scroll-pb-14",
          "landscape-phone:-mr-3 landscape-phone:pr-3 landscape-phone:-ml-1 landscape-phone:pl-1",
          "landscape-phone:w-[calc(100%+16px)]",
        )}
      >
        <div
          className={clsx(
            "predict-header bg-fs-surface mb-2 flex h-8 shrink-0 items-center justify-between",
            "landscape-phone:sticky landscape-phone:top-0 landscape-phone:z-20",
            // the gap under the title is the header's own surface there, so nothing shows through it
            "landscape-phone:mb-0 landscape-phone:box-content landscape-phone:pb-2",
          )}
        >
          <h2 className="text-fs-popup-text text-lg font-semibold tracking-[-0.01em]">Predict</h2>
          <LightButton
            text=""
            aria-label="Close"
            icon={<CloseIcon className="text-fs-popup-text-2 size-4.5" />}
            isDisabled={isRunning}
            onPress={onClose}
            className={clsx(
              "relative -mr-1.5 size-8 justify-center rounded-full! p-0",
              "hover:bg-transparent [@media(hover:hover)]:hover:bg-fs-popup-hover disabled:opacity-40",
              "before:absolute before:-inset-1.5 before:content-['']",
              // the scroller's top edge is the button's, so its ring sits inside
              "landscape-phone:[--fs-focus-offset:-2px]",
            )}
          />
        </div>

        <section
          data-panel="estimates"
          className="rounded-fs-panel bg-fs-popup-panel shrink-0 px-4 pt-3 pb-1.5 short:pt-2.5 short:pb-1"
        >
          <h3 className="type-label text-fs-popup-text-2 font-medium tabular-nums">
            {`${selected.length} ${selected.length === 1 ? "estimate" : "estimates"}`}
          </h3>
          {/* over four rows three and a half show, over three on a phone two and a half: the cut row, under a row-tall fade, is the cue */}
          <ScrollFade
            fadeFrom="from-fs-popup-panel"
            fadeSize={32}
            className={clsx("mt-1 w-full", selected.length > 4 && "max-h-28", selected.length > 3 && "max-sm:max-h-20")}
          >
            <PredictList
              selected={selected}
              onRemove={onRemove}
              isReadOnly={isLocked}
              isFixed={recovered !== undefined}
            />
          </ScrollFade>
        </section>

        {/* the steps end flush with the body, so any overflow hides some of them */}
        {/* a step row's height of fade, so a bullet half under it never shows a hard edge */}
        <ScrollFade
          className="landscape-phone:min-h-0 landscape-phone:flex-none min-h-32 w-full"
          cue="More below"
          cueTone="border-(--fs-popup-line) text-fs-popup-text-2"
          minOverflow={1}
          fadeSize={40}
        >
          <div data-testid="predict-body" className="pt-2 short:pt-1.5">
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
              credits={credits}
            />
            <PredictSummary
              selected={selected}
              preview={shownPreview}
              collateral={collateral}
              // a stored run minted what it stored, not what this form holds
              mint={recovered || !shownFunding ? undefined : { amount: shownFunding.collateralIn, noun: optionNoun }}
              isOpen={summaryOpen}
              onToggle={() => setSummaryOpen((open) => !open)}
              isPricing={isPricing}
              isEstimated={(runToken ?? token).id === "native"}
            />
            <PredictStepsTimeline steps={steps} />
          </div>
        </ScrollFade>

        {/* outside the body's scroll area, so the reason a run stopped shows with the button; two lines held empty or not */}
        <p
          ref={statusRef}
          role="status"
          aria-live="polite"
          className={clsx(
            "type-label flex h-10 shrink-0 items-center text-left text-[13px] leading-[18px] text-pretty",
            status && STATUS_TONE[status.tone],
          )}
        >
          {status ? (
            <span key={status.text} className={clsx(status.tone === "error" && "fs-enter")}>
              {status.text}
            </span>
          ) : null}
        </p>

        <div className="bg-fs-surface landscape-phone:pb-2 sticky bottom-0 pt-1 pb-4 short:pb-3">
          <PredictButton
            text={recovered ? "Resume" : isPending ? "Check again" : canRetry ? "Try the rest" : "Predict"}
            busyText={isRunning ? (isPricing ? CHECKING_PRICES : busyLabel(steps)) : undefined}
            onPress={onPredict}
            isDisabled={
              notice !== undefined ||
              (!canRetry &&
                (recovered !== undefined || selected.length === 0 || funding === null || tooMuch || nothingToTrade))
            }
          />
        </div>
      </div>
    </Modal>
  );
}

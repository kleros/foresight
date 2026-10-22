"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import clsx from "clsx";

import LightButton from "@/components/ui/LightButton";
import { Modal } from "@/components/ui/Modal";
import { ScrollFade } from "@/components/ui/ScrollFade";

import CloseIcon from "@/assets/svg/close.svg";

import { formatEstimate } from "@/utils/formatEstimate";
import { INERT } from "@/utils/inert";

import type { PayToken } from "../types";
import { GearIcon } from "./GearIcon";
import { PredictAmountSection, type PayTokenChoice } from "./PredictAmountSection";
import { PredictButton } from "./PredictButton";
import type { CreditsChoice } from "./PredictCreditsLine";
import { PredictList, type ListedEstimate, type PriceMove } from "./PredictList";
import { PredictSettings, reachable } from "./PredictSettings";
import { PredictStepsTimeline } from "./PredictStepsTimeline";
import { PredictSummary, type CreditsSwapShown } from "./PredictSummary";
import { StatusGlyph } from "./StatusGlyph";
import { HIGH_SLIPPAGE_BPS } from "../oracle/tolerances";
import { shownAmount, type Funding } from "../utils/funding";
import {
  CHECKING_PRICES,
  CONFIRM_MOVED,
  CONFIRM_SLIPPAGE,
  statusLine,
  type MovedStatus,
  type PredictSteps,
} from "../utils/predictSteps";
import { resolveSlippage, type SlippageKind, type SlippageSettings } from "../utils/slippage";

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
  leftOut: number;
  /** A run is between its first signature and its end. */
  isRunning: boolean;
  /** A stopped run can pick up where it stopped, with the amount and estimates it was started with. */
  canRetry: boolean;
  /** The stopped run sent a transaction whose outcome is unknown; pressing on checks it first. */
  isPending?: boolean;
  /**
   * A stored run under review: its own deposit fills the locked amount form, Resume replaces Predict, and Details
   * names its own slippage, the credits swap's only while that swap is still to sign.
   */
  recovered?: {
    deposit: bigint;
    token: PayTokenChoice;
    /** The collateral an xDAI deposit becomes, said beside it; absent for a collateral deposit. */
    deposited?: bigint;
    slippage: { tradeBps: number; creditsBps?: number };
  };
  /** What the visitor has to do before this prediction can be made, if anything. */
  notice?: string;
  /** The visitor's slippage, which the settings panel changes. */
  slippage: { settings: SlippageSettings; onChange: (kind: SlippageKind, bps: number | null) => void };
  /** Credits the run would swap into xDAI and the swap as quoted now; absent where it spends none. */
  creditsSwap?: CreditsSwapShown;
  /** What changed when the pools were read again before signing; the button then confirms the new figures. */
  moved?: { markets: number; credits: boolean; bySlippage?: true };
  /** Every option's plan is read, and the credits swap's quote where credits are spent, so Predict holds the run to them. */
  pricesReady: boolean;
  /** Declines the moved figures and gives the form back, where nothing has been signed. */
  onBack?: () => void;
  /** Reads the prices again where they could not be read; the button then offers it. */
  onRetryPrices?: () => void;
  /** The prices are being read again. */
  isRetryingPrices?: boolean;
  /** Starts a run, picks a stopped one up again, or confirms moved prices. */
  onPredict: () => void;
}

/** What `value` was when `lock` last took a new key, held until it is null. */
function useHeldWhile<T>(value: T, lock: string | null): T {
  const [held, setHeld] = useState<{ value: T; lock: string } | null>(lock === null ? null : { value, lock });
  if (lock !== null && held?.lock !== lock) setHeld({ value, lock });
  if (lock === null && held) setHeld(null);
  return lock !== null && held?.lock === lock ? held.value : value;
}

/** A credits swap losing at least this share of the credits' value is said on the status line before a run. */
const LOUD_LOSS_BPS = BigInt(HIGH_SLIPPAGE_BPS.creditsBps);

/** The one market whose plan changed, where it now goes and where it went, for the status line. */
function onlyMoved(selected: ListedEstimate[], preview: Record<string, PriceMove> | undefined): MovedStatus["only"] {
  const changed = selected.filter((estimate) => preview?.[estimate.scale.market.toLowerCase()]?.was);
  if (changed.length !== 1) return undefined;
  const estimate = changed[0]!;
  const move = preview![estimate.scale.market.toLowerCase()]!;
  const format = (value: number) => formatEstimate(value, estimate.scale.unit);
  const [to, was] = [format(move.to), format(move.was!.to)];
  return to === was ? undefined : { name: estimate.scale.name, to, was };
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

function recoveryNote(
  recovered: NonNullable<PredictDialogProps["recovered"]>,
  collateral: { symbol: string; decimals: number },
): string {
  if (recovered.deposited === undefined) return "Locked to this prediction's amount.";
  const deposited = shownAmount(recovered.deposited, collateral.decimals);
  return `Locked to this prediction's amount; the deposit ≈ ${deposited} ${collateral.symbol}.`;
}

// the width under which the moved footer stacks, as its [@media(max-width:374px)] classes say
const STACKED = "(max-width: 374px)";
const subscribeStacked = (onChange: () => void) => {
  const query = window.matchMedia?.(STACKED);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
};
const isStackedNow = () => window.matchMedia?.(STACKED).matches ?? false;

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
  leftOut,
  isRunning,
  canRetry,
  isPending = false,
  recovered,
  notice,
  slippage,
  creditsSwap,
  moved,
  pricesReady,
  onBack,
  onRetryPrices,
  isRetryingPrices = false,
  onPredict,
}: PredictDialogProps) {
  const isMoved = moved !== undefined;
  const isHeld = isRunning || canRetry || recovered !== undefined;
  // at moved the visitor confirms the figures as shown, so the form cannot change under them
  const isLocked = isHeld || isMoved;
  // what is shown is held through a run, and taken afresh as the run stops at moved or goes on from it
  const lock = isMoved ? "moved" : isHeld ? "run" : null;
  const tooMuch = funding !== null && amount !== undefined && amount > funding.available;
  // with nothing held, an empty amount has nothing to trade with
  const nothingToTrade = isFirstPrediction && (funding?.collateralIn ?? 0n) === 0n;
  const isPricing = steps.pricing === true;
  const runToken = recovered?.token;
  // a refreshed balance or re-priced preview would change what the visitor is reading mid-run
  const shownFunding = useHeldWhile(funding, lock);
  const shownPreview = useHeldWhile(preview, lock);
  const shownCreditsSwap = useHeldWhile(creditsSwap, lock);
  const swap = recovered ? undefined : shownCreditsSwap?.preview;
  const resolved = resolveSlippage(slippage.settings);
  const inUse = {
    tradeBps: resolved.tradeBps,
    ...(shownCreditsSwap && !shownCreditsSwap.landed ? { creditsBps: resolved.creditsBps } : {}),
  };
  const status = statusLine({
    steps,
    notice,
    leftOut,
    moved: moved && { ...moved, only: onlyMoved(selected, shownPreview) },
    creditsLoss:
      swap && swap.loss * 10_000n >= swap.vaultValue * LOUD_LOSS_BPS
        ? `≈\u00a0${shownAmount(swap.loss, 18)}\u00a0xDAI`
        : undefined,
  });
  // the visitor's choice, but for moved figures, which the status line asks them to check there
  const [summaryOpen, setSummaryOpen] = useState(isMoved);
  const [wasMoved, setWasMoved] = useState(isMoved);
  if (isMoved !== wasMoved) {
    setWasMoved(isMoved);
    if (isMoved) setSummaryOpen(true);
  }
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isMoved) return;
    // after the summary's rows unfold, so the first changed figure is where it scrolls to
    const unfold = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fs-dur-enter")) || 0;
    const timer = setTimeout(() => {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      bodyRef.current
        ?.querySelector("[data-testid=market-was], [data-testid=credits-was]")
        ?.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    }, unfold);
    return () => clearTimeout(timer);
  }, [isMoved]);
  const statusRef = useRef<HTMLParagraphElement>(null);
  // a stopped run's retry takes up new settings and stops at moved where they change its plan; a stored run
  // has no plan shown to check against, and a sent transaction is settled before anything else
  const settingsLocked = isRunning || isMoved || recovered !== undefined || isPending;
  const [settingsWanted, setSettingsWanted] = useState(false);
  const settingsOpen = settingsWanted && !settingsLocked;
  const isCustomSlippage =
    slippage.settings.tradeBps !== null || (credits !== undefined && slippage.settings.creditsBps !== null);
  const customId = useId();
  const settingsId = useId();
  const titleId = useId();
  const gearRef = useRef<HTMLButtonElement>(null);
  const firstSetting = useRef<HTMLButtonElement>(null);
  const settingsPanel = useRef<HTMLDivElement>(null);
  const settingsWereOpen = useRef(false);
  useEffect(() => {
    if (settingsOpen) firstSetting.current?.focus();
    else if (settingsWereOpen.current) gearRef.current?.focus();
    settingsWereOpen.current = settingsOpen;
  }, [settingsOpen]);
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

  // stacked, Go back follows Confirm in the DOM as on screen, so focus runs top to bottom
  const isStacked = useSyncExternalStore(subscribeStacked, isStackedNow, () => false);
  const goBack = onBack ? (
    <div className="fs-enter w-28 shrink-0 [@media(max-width:374px)]:w-full">
      <PredictButton text="Go back" quiet isDisabled={false} onPress={onBack} />
    </div>
  ) : null;

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
          "relative flex min-h-0 w-full flex-col",
          // under the settings only the panel scrolls
          settingsOpen ? "landscape-phone:overflow-hidden" : "landscape-phone:overflow-y-auto",
          "landscape-phone:scroll-pt-10 landscape-phone:scroll-pb-17",
          "short:landscape-phone:scroll-pb-15",
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
          <h2 id={titleId} className="text-fs-popup-text text-lg font-semibold tracking-[-0.01em]">
            {/* keyed, so the new title enters as the panel does */}
            <span key={settingsOpen ? "settings" : "predict"} className="predict-text-swap inline-block">
              {settingsOpen ? "Settings" : "Predict"}
            </span>
          </h2>
          <div className="flex items-center gap-1">
            <button
              ref={gearRef}
              type="button"
              aria-label="Settings"
              aria-expanded={settingsOpen}
              aria-controls={settingsId}
              aria-describedby={isCustomSlippage ? customId : undefined}
              disabled={settingsLocked}
              onClick={() => setSettingsWanted((open) => !open)}
              onKeyDown={(event) => {
                // the body under the panel is inert, so the dialog's own wrap finds nothing before the gear
                if (!settingsOpen || event.key !== "Tab" || !event.shiftKey) return;
                const last = reachable(settingsPanel.current).at(-1);
                if (!last) return;
                event.preventDefault();
                event.stopPropagation();
                last.focus();
              }}
              className={clsx(
                "group relative grid size-8 cursor-pointer place-items-center rounded-full",
                "transition-colors duration-(--fs-dur-echo) ease-(--fs-ease-enter)",
                "[@media(hover:hover)]:hover:bg-fs-popup-hover aria-expanded:bg-fs-popup-chip",
                "disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent",
                "before:absolute before:-inset-1.5 before:content-['']",
                "landscape-phone:[--fs-focus-offset:-2px]",
              )}
            >
              <GearIcon className="text-fs-popup-text-2 size-4.5" />
              <span id={customId} className="sr-only">
                Custom slippage set
              </span>
              <span
                aria-hidden
                data-testid={isCustomSlippage ? "settings-custom" : undefined}
                data-open={isCustomSlippage || undefined}
                className={clsx(
                  "predict-gear-dot bg-fs-popup-accent-text absolute top-1 right-1 size-1.5 rounded-full",
                  // the ring takes the button's own fill, so it parts the dot from the gear and nothing else
                  "ring-fs-surface ring-2 [@media(hover:hover)]:group-enabled:group-hover:ring-fs-popup-hover",
                  "group-aria-expanded:ring-fs-popup-chip",
                )}
              />
            </button>
            <LightButton
              text=""
              aria-label={settingsOpen ? "Close settings" : "Close"}
              icon={<CloseIcon className="text-fs-popup-text-2 size-4.5" />}
              isDisabled={isRunning}
              // under the Settings title the X closes the settings, not the prediction behind them
              onPress={settingsOpen ? () => setSettingsWanted(false) : onClose}
              className={clsx(
                "relative -mr-1.5 size-8 justify-center rounded-full! p-0",
                "hover:bg-transparent [@media(hover:hover)]:hover:bg-fs-popup-hover disabled:opacity-40",
                "before:absolute before:-inset-1.5 before:content-['']",
                // the scroller's top edge is the button's, so its ring sits inside
                "landscape-phone:[--fs-focus-offset:-2px]",
              )}
            />
          </div>
        </div>

        <PredictSettings
          id={settingsId}
          labelledBy={titleId}
          isOpen={settingsOpen}
          settings={slippage.settings}
          onChange={slippage.onChange}
          onClose={() => setSettingsWanted(false)}
          hasCredits={credits !== undefined}
          panelRef={settingsPanel}
          firstControlRef={firstSetting}
          onTabPastEnd={() => gearRef.current?.focus()}
        />

        {/* takes no box, so the regions stay the column's own; under the settings they keep their space, out of reach */}
        <div className="contents" {...(settingsOpen ? INERT : {})}>
          <section
            data-panel="estimates"
            className="rounded-fs-panel bg-fs-popup-panel shrink-0 px-4 pt-3 pb-1.5 short:pt-1.5 short:pb-0.5"
          >
            <h3 className="type-label text-fs-popup-text-2 font-medium tabular-nums">
              {`${selected.length} ${selected.length === 1 ? "estimate" : "estimates"}`}
            </h3>
            {/* over four rows three and a half show, over three on a phone two and a half: the cut row, under a row-tall fade, is the cue */}
            <ScrollFade
              fadeFrom="from-fs-popup-panel"
              fadeSize={32}
              className={clsx(
                "mt-1 w-full",
                selected.length > 4 && "max-h-28",
                selected.length > 3 && "max-sm:max-h-20",
              )}
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
            // a status callout starts right under the cue, so its nudge is smaller
            cueLift={status ? 2 : 3}
            cueDrop={status ? 3 : 6}
            minOverflow={1}
            fadeSize={40}
          >
            <div ref={bodyRef} data-testid="predict-body" className="pt-2 short:pt-1 landscape-phone:pt-1.5">
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
                note={recovered ? recoveryNote(recovered, collateral) : undefined}
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
                // before the run, Details waits for the plans Predict will hold the run to
                isPricing={
                  isPricing ||
                  isRetryingPrices ||
                  (!pricesReady && !isLocked && notice === undefined && selected.length > 0)
                }
                isEstimated={(runToken ?? token).id === "native"}
                creditsSwap={recovered ? undefined : shownCreditsSwap}
                slippage={recovered?.slippage ?? inUse}
                onOpenSettings={settingsLocked ? undefined : () => setSettingsWanted(true)}
              />
              <PredictStepsTimeline steps={steps} />
            </div>
          </ScrollFade>

          {/* outside the body's scroll area, so the reason a run stopped shows with the button; its slot is held empty or not */}
          <p
            ref={statusRef}
            role="status"
            aria-live="polite"
            data-tone={status?.tone}
            className="predict-status text-left"
          >
            {status ? (
              <span
                key={status.text}
                data-testid="status-box"
                data-small={status.small}
                className={clsx("predict-status-box", status.tone !== "neutral" && "fs-enter")}
              >
                <StatusGlyph status={status} />
                <span data-testid="status-text">{status.text}</span>
              </span>
            ) : null}
          </p>

          {/* under 375px Go back and Confirm new prices outgrow one row, so Confirm stacks over Go back */}
          <div
            className={clsx(
              "predict-footer bg-fs-surface landscape-phone:pb-2 sticky bottom-0 flex gap-2 pt-2 pb-4 short:pb-3",
              "[@media(max-width:374px)]:flex-col",
            )}
          >
            {isMoved && onBack && !isStacked ? goBack : null}
            <PredictButton
              text={
                onRetryPrices
                  ? "Try again"
                  : recovered
                    ? "Resume"
                    : isPending
                      ? "Check again"
                      : canRetry
                        ? "Try the rest"
                        : isMoved
                          ? moved?.bySlippage
                            ? CONFIRM_SLIPPAGE
                            : CONFIRM_MOVED
                          : "Predict"
              }
              busyText={
                isRunning
                  ? isPricing
                    ? CHECKING_PRICES
                    : busyLabel(steps)
                  : isRetryingPrices
                    ? CHECKING_PRICES
                    : undefined
              }
              onPress={onRetryPrices ?? onPredict}
              isDisabled={
                onRetryPrices
                  ? false
                  : notice !== undefined ||
                    (!canRetry &&
                      !isMoved &&
                      (recovered !== undefined ||
                        selected.length === 0 ||
                        funding === null ||
                        tooMuch ||
                        nothingToTrade ||
                        !pricesReady))
              }
            />
            {isMoved && onBack && isStacked ? goBack : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}

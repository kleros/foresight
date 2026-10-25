"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { Button } from "@kleros/ui-components-library";
import clsx from "clsx";
import type { Address } from "viem";
import { useAccount } from "wagmi";

import type { PredictSnapshot } from "@/features/predict/flow/types";
import {
  discardRun,
  findInterruptedRun,
  hasPendingTransaction,
  predictRunStore,
  predictFlowId,
} from "@/features/predict/run/interrupted";
import { tabOwnership } from "@/features/predict/run/ownership";
import { useSessionEstimates } from "@/features/predict/stores/estimateStore";
import type { SelectedEstimate } from "@/features/predict/types";
import { selectedEstimates } from "@/features/predict/utils/estimates";
import { PROMPT_OPEN, RUNNING_ELSEWHERE } from "@/features/predict/utils/predictSteps";
import type { SessionDetail, SessionStatus } from "@/features/sessions/types";
import { optionNoun, optionNounSingular } from "@/features/sessions/utils/optionNoun";

import { SectionCard } from "@/components/ui/SectionCard";
import EnsureChain from "@/components/wallet/EnsureChain";

import { ownedAmount } from "@/utils/amount";
import { formatEstimate } from "@/utils/formatEstimate";
import { INERT } from "@/utils/inert";

import { type PredictBlocker, predictBlocker } from "./predictBlocker";
import type { PlacedPrediction } from "./PredictSuccessView";
import { usePredictDock } from "./usePredictDock";

// The run pulls in the orchestrator, the quoter and a chain client; none of that belongs on the
// page until someone asks to predict.
const PredictRunner = dynamic(() => import("./PredictRunner").then((module) => module.PredictRunner), { ssr: false });

const PredictSuccessDialog = dynamic(
  () => import("./PredictSuccessDialog").then((module) => module.PredictSuccessDialog),
  { ssr: false },
);

const CTA = "predict-cta predict-card-cta";

/** How often a held run is asked about again, since letting go of it writes nothing. */
const HELD_ELSEWHERE_POLL_MS = 2_000;

// a stored run's reason is said in the run's own row, beside its Resume
const blockerText = (blocker: Exclude<PredictBlocker, "unfinished">, noun: string): string =>
  ({
    closed: "Trading has closed.",
    "no-liquidity": `None of the ${noun} can be traded yet.`,
    "no-move": "Set an estimate above or below the market to predict.",
    disconnected: "Connect a wallet to predict.",
  })[blocker];

interface PredictCardProps {
  session: SessionDetail;
  status: SessionStatus;
  marketEstimates: Record<string, number | undefined>;
  /** True while the market numbers are loading or failed; an empty `marketEstimates` says nothing then. */
  isMarketUnknown?: boolean;
}

export function PredictCard({ session, status, marketEstimates, isMarketUnknown = false }: PredictCardProps) {
  // what the popup lists, held from the press so a market refresh cannot empty it under the visitor
  const [opened, setOpened] = useState<SelectedEstimate[]>();
  const isOpen = opened !== undefined;
  const [isSuccessOpen, setIsSuccessOpen] = useState(false);
  const [leftOut, setLeftOut] = useState<string[]>([]);
  const [placedRun, setPlacedRun] = useState<PlacedPrediction>();
  const { address } = useAccount();
  // what this page last placed, by owner and lower-case market
  const [placed, setPlaced] = useState<{ owner: Address; values: Record<string, number> }>();
  // the stored run as last read, and for which wallet; unread until the effect below runs for this one
  const [stored, setStored] = useState<{ owner: Address | undefined; run: PredictSnapshot | null }>();
  const interrupted = stored && stored.owner === address ? stored.run : undefined;
  const [isPending, setIsPending] = useState(false);
  const [reads, setReads] = useState(0);
  // whether another open tab drives the stored run; unknown until a tab is asked
  const [heldElsewhere, setHeldElsewhere] = useState<boolean>();
  // whether this tab holds it for a wallet prompt a closed popup left open
  const [heldHere, setHeldHere] = useState(false);
  const asked = useRef(0);
  const isHeld = heldElsewhere !== false;

  const readStored = (isClosing = false) => {
    const store = predictRunStore();
    const run = address ? findInterruptedRun(store, session.id, address) : null;
    setStored({ owner: address, run });
    setIsPending(address ? hasPendingTransaction(store, session.id, address) : false);
    const ask = ++asked.current;
    if (!run || !address) {
      setHeldElsewhere(false);
      setHeldHere(false);
      return;
    }
    const flowId = predictFlowId(session.id, address);
    // the closing popup's driver holds the run until it unmounts; the read after that sets it
    if (!isClosing) setHeldHere(tabOwnership().heldHere(flowId));
    void tabOwnership()
      .heldElsewhere(flowId)
      .then((held) => {
        if (asked.current === ask) setHeldElsewhere(held);
      });
  };

  // read after mount and after the popup, which may have finished or discarded the run; while it is open the card
  // keeps the run as last read, so Resume does not light up Predict behind it
  useEffect(() => {
    if (!isOpen) readStored();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- readStored reads only address and session.id
  }, [address, isOpen, session.id, reads]);

  // another tab's run lives in the same storage; a null key is a clear of all of it
  useEffect(() => {
    if (!address) return;
    const flowId = predictFlowId(session.id, address);
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.endsWith(`.${flowId}`)) setReads((count) => count + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [address, session.id]);

  // a tab that closes or lets go of the run writes nothing, so a held run is asked about again
  useEffect(() => {
    if (!interrupted || !(heldElsewhere || heldHere)) return;
    const timer = setInterval(() => setReads((count) => count + 1), HELD_ELSEWHERE_POLL_MS);
    return () => clearInterval(timer);
  }, [interrupted, heldElsewhere, heldHere]);

  // re-read rather than clear: discardRun keeps a run whose transaction awaits a receipt. The run is held for the
  // read and the delete, so no other tab can start signing it in between
  const discard = async () => {
    const letGo = address ? await tabOwnership().claim(predictFlowId(session.id, address)) : null;
    if (address && letGo) {
      try {
        discardRun(predictRunStore(), session.id, address);
      } finally {
        letGo();
      }
    }
    setReads((count) => count + 1);
  };

  // read in the same commit that closes the popup, so the card never shows a run the popup has since finished
  const closePopup = () => {
    readStored(true);
    setOpened(undefined);
  };

  const runShown = (run: PredictSnapshot) => {
    const deposit = run.depositNative
      ? `${ownedAmount(run.deposit, 18)} xDAI`
      : `${ownedAmount(run.deposit, session.collateralDecimals ?? 18)} ${session.collateralSymbol ?? "sDAI"}`;
    const parts = [
      ...(run.deposit > 0n ? [`a deposit of ${deposit}`] : []),
      ...(run.creditsToSpend > 0n ? [`${ownedAmount(run.creditsToSpend, 18)} in credits`] : []),
    ];
    return parts.length > 0
      ? `A prediction with ${parts.join(" and ")} did not finish.`
      : "A prediction did not finish.";
  };

  const estimates = useSessionEstimates(session.parentMarket);
  const selected = selectedEstimates(session.options, estimates, marketEstimates);
  // a stored run is resumed or discarded before a new one starts; unread counts as stored
  const isDisabled = selected.length === 0 || status !== "trading" || !address || interrupted !== null;
  const blocker = predictBlocker({
    status,
    options: session.options,
    marketEstimates,
    isMarketUnknown,
    selectedCount: selected.length,
    isConnected: Boolean(address),
    hasStoredRun: Boolean(interrupted),
  });
  const changed = selected.filter(
    (estimate) => placed?.owner !== address || placed?.values[estimate.scale.market.toLowerCase()] !== estimate.value,
  );
  // with nothing changed, the same estimates can still be backed with more funds
  const toPredict = changed.length > 0 ? changed : selected;

  // the phone dock carries only a live Predict; otherwise the card stays in the page and says why
  const isLive = !isDisabled && blocker === null && interrupted === null;
  const content = toPredict.map((estimate) => `${estimate.scale.market}:${estimate.value}`).join();
  const dock = usePredictDock(isLive, content);
  const isDocked = dock.isDocked;
  // a leaving bar sinks as it was while live, not as the card it leaves behind
  const [lastLive, setLastLive] = useState<{ content: string; picks: SelectedEstimate[] }>();
  if (isLive && lastLive?.content !== content) setLastLive({ content, picks: toPredict });
  const isLeaving = dock.phase === "leaving";
  const shown = isLeaving ? (lastLive?.picks ?? []) : toPredict;
  const pausedRun = isLeaving ? null : interrupted;

  const count = `${shown.length} ${shown.length === 1 ? "estimate" : "estimates"}`;
  const predict = (text: string) => {
    const button = (
      <Button className={CTA} text={text} isDisabled={isDisabled && !isLeaving} onPress={() => setOpened(toPredict)} />
    );
    // without a wallet the button stays put and disabled; the blocker line says to connect
    return address ? <EnsureChain className={CTA}>{button}</EnsureChain> : button;
  };

  return (
    <div
      ref={dock.ref}
      data-predict-dock={isDocked ? "" : undefined}
      data-stuck={dock.isStuck ? "" : undefined}
      data-entering={dock.phase === "entering" ? "" : undefined}
      data-leaving={dock.phase === "leaving" ? "" : undefined}
      {...(dock.phase === "leaving" ? INERT : {})}
      onAnimationEnd={dock.onAnimationEnd}
      style={dock.style}
      className={clsx(isDocked && "predict-dock")}
    >
      <SectionCard
        className={clsx(
          "p-4 md:px-8",
          "flex flex-wrap items-start justify-start gap-x-6 gap-y-4",
          "md:flex-row md:items-center md:justify-between",
          isDocked && "predict-dock-panel max-md:block",
        )}
      >
        {/* pinned on a phone, the heading folds away and leaves [chips | Predict] */}
        <div className={isDocked ? "predict-dock-fold" : "contents"}>
          <div className={isDocked ? "min-h-0 overflow-hidden md:contents" : "contents"}>
            <div className={clsx(isDocked && "max-md:pb-4", "md:contents")}>
              {/* from md to lg the heading and button share a row, the picks one of their own under them */}
              <h3 className="text-fs-text-primary text-base font-semibold md:max-lg:order-first">
                Place your estimates
              </h3>
            </div>
          </div>
        </div>
        <div className={isDocked ? "max-md:flex max-md:items-center max-md:gap-3 md:contents" : "contents"}>
          {shown.length > 0 && pausedRun === null ? <Picks selected={shown} /> : null}
          <div className="shrink-0 md:max-lg:order-first">
            {pausedRun ? (
              <Button className={CTA} text="Resume" isDisabled={isHeld} onPress={() => setOpened(toPredict)} />
            ) : (
              <>
                <div className="md:hidden">{predict("Predict")}</div>
                <div className="max-md:hidden">
                  {predict(shown.length > 0 ? `Predict ${count}` : "Predict estimates")}
                </div>
              </>
            )}
          </div>
        </div>
        {blocker && blocker !== "unfinished" && !isLeaving ? (
          <p className="text-fs-text-secondary w-full text-sm">
            {blockerText(blocker, optionNoun(session.itemNamePlural))}
          </p>
        ) : null}

        {pausedRun ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <p className="text-fs-text-secondary text-sm">
              {runShown(pausedRun)}
              {heldElsewhere ? ` ${RUNNING_ELSEWHERE}` : null}
              {heldHere && !heldElsewhere ? ` ${PROMPT_OPEN}` : null}
              {isPending && !heldElsewhere ? " A transaction from it may still be pending." : null}
              {/* a run whose transaction awaits a receipt offers no Discard */}
              {blocker === "unfinished" && !heldElsewhere && !heldHere
                ? isPending
                  ? " Resume it before starting a new one."
                  : " Resume or discard it before starting a new one."
                : null}
            </p>
            <div className="flex gap-3">
              {isPending || heldElsewhere ? null : (
                <Button
                  small
                  variant="secondary"
                  text="Discard"
                  isDisabled={isHeld || heldHere}
                  onPress={() => void discard()}
                />
              )}
              <div className="md:hidden">
                <Button className="predict-held" small variant="secondary" text="Predict" isDisabled />
              </div>
              <div className="max-md:hidden">
                <Button className="predict-held" small variant="secondary" text={`Predict ${count}`} isDisabled />
              </div>
            </div>
          </div>
        ) : null}

        {/* outside the chain gate, so a wallet switching away mid-run does not unmount the run */}
        {isOpen ? (
          <PredictRunner
            session={session}
            status={status}
            selected={opened}
            onClose={closePopup}
            onSuccess={(leftOut: Address[], run: PlacedPrediction) => {
              if (address) {
                const traded = opened.filter((estimate) => !leftOut.includes(estimate.scale.market));
                setPlaced({
                  owner: address,
                  values: {
                    ...(placed?.owner === address ? placed.values : {}),
                    ...Object.fromEntries(
                      traded.map((estimate) => [estimate.scale.market.toLowerCase(), estimate.value]),
                    ),
                  },
                });
              }
              setLeftOut(
                session.options.filter((option) => leftOut.includes(option.market)).map((option) => option.name),
              );
              setPlacedRun(run);
              closePopup();
              setIsSuccessOpen(true);
            }}
          />
        ) : null}
        {isSuccessOpen ? (
          <PredictSuccessDialog
            isOpen
            placed={placedRun}
            leftOut={leftOut}
            optionNoun={optionNounSingular(session.itemName)}
            onClose={() => setIsSuccessOpen(false)}
          />
        ) : null}
      </SectionCard>
    </div>
  );
}

const SHOWN_WIDE = 3;
const SHOWN_NARROW = 2;
const SHOWN_PINNED = 1;

/**
 * The picks Predict would send, as chips: three from lg up, two below, and a count of the rest. The pinned phone bar
 * keeps one chip by CSS alone, so the markup, and the height it takes docked, is the same pinned or not.
 */
function Picks({ selected }: { selected: SelectedEstimate[] }) {
  const more = (shown: number) => selected.length - shown;
  const morePill = (shown: number, className: string) =>
    more(shown) > 0 ? (
      <li
        aria-label={`${more(shown)} more ${more(shown) === 1 ? "estimate" : "estimates"}`}
        className={clsx(
          "text-fs-popup-text-2 h-7 shrink-0 items-center rounded-full border border-(--fs-popup-line-strong) px-2.5",
          "text-[13px] leading-[18px] font-medium tabular-nums",
          className,
        )}
      >
        {`+${more(shown)}`}
      </li>
    ) : null;

  return (
    <ul
      aria-label="Your estimates"
      className="predict-picks flex min-w-0 flex-[1_1_100%] flex-wrap gap-2 lg:flex-1 lg:justify-end"
    >
      {selected.map((estimate, index) => {
        const higher = estimate.direction === "higher";
        return (
          <li
            key={estimate.scale.market}
            className={clsx(
              "fs-rise bg-fs-popup-chip text-fs-popup-text h-7 max-w-full items-center gap-1.5 rounded-full px-2.5",
              "text-[13px] leading-[18px] font-medium whitespace-nowrap tabular-nums md:max-w-[200px]",
              index >= SHOWN_WIDE
                ? "hidden"
                : index >= SHOWN_NARROW
                  ? "inline-flex max-lg:hidden"
                  : index >= SHOWN_PINNED
                    ? "predict-pin-hide inline-flex"
                    : "inline-flex",
            )}
          >
            <span className="min-w-0 truncate" title={estimate.scale.name}>
              {estimate.scale.name}
            </span>
            <span className="text-fs-popup-text-2 inline-flex shrink-0 items-center gap-1 font-semibold">
              <svg
                role="img"
                aria-label={higher ? "above the market" : "below the market"}
                viewBox="0 0 12 12"
                fill="none"
                className={clsx("size-3 shrink-0", !higher && "rotate-180")}
              >
                <path
                  d="M6 10.5V1.5M2.5 5 6 1.5 9.5 5"
                  stroke="currentColor"
                  strokeWidth="1.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="predict-chip-figure">{formatEstimate(estimate.value, estimate.scale.unit)}</span>
            </span>
          </li>
        );
      })}
      {morePill(SHOWN_WIDE, "inline-flex max-lg:hidden")}
      {morePill(SHOWN_NARROW, "predict-pin-hide inline-flex lg:hidden")}
      {morePill(SHOWN_PINNED, "predict-pin-pill")}
    </ul>
  );
}

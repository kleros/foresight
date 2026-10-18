"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { Button } from "@kleros/ui-components-library";
import clsx from "clsx";
import type { Address } from "viem";
import { useAccount } from "wagmi";

import type { PredictSnapshot } from "@/features/predict/flow/types";
import { discardRun, findInterruptedRun, hasPendingTransaction } from "@/features/predict/run/interrupted";
import { useSessionEstimates } from "@/features/predict/stores/estimateStore";
import type { SelectedEstimate } from "@/features/predict/types";
import { selectedEstimates } from "@/features/predict/utils/estimates";
import type { SessionDetail, SessionStatus } from "@/features/sessions/types";
import { optionNoun } from "@/features/sessions/utils/optionNoun";

import { SectionCard } from "@/components/ui/SectionCard";
import EnsureChain from "@/components/wallet/EnsureChain";

import CheckOutline from "@/assets/svg/check-outline-button.svg";

import { ownedAmount } from "@/utils/amount";

import { createRunStore } from "@/lib/flowRunStore";

import { type PredictBlocker, predictBlocker } from "./predictBlocker";
import type { PlacedPrediction } from "./PredictSuccessView";

// The run pulls in the orchestrator, the quoter and a chain client; none of that belongs on the
// page until someone asks to predict.
const PredictRunner = dynamic(() => import("./PredictRunner").then((module) => module.PredictRunner), { ssr: false });

const PredictSuccessDialog = dynamic(
  () => import("./PredictSuccessDialog").then((module) => module.PredictSuccessDialog),
  { ssr: false },
);

const blockerText = (blocker: PredictBlocker, noun: string): string =>
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
  const [interrupted, setInterrupted] = useState<PredictSnapshot | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [discards, setDiscards] = useState(0);

  // read after mount: the stored run lives in this browser, and the popup may have finished or discarded it
  useEffect(() => {
    const store = createRunStore();
    setInterrupted(address && !isOpen ? findInterruptedRun(store, session.id, address) : null);
    setIsPending(address && !isOpen ? hasPendingTransaction(store, session.id, address) : false);
  }, [address, isOpen, session.id, discards]);

  // re-read rather than clear: discardRun keeps a run whose transaction awaits a receipt
  const discard = () => {
    if (address) discardRun(createRunStore(), session.id, address);
    setDiscards((count) => count + 1);
  };

  const depositShown = (run: PredictSnapshot) =>
    run.depositNative
      ? `${ownedAmount(run.deposit, 18)} xDAI`
      : `${ownedAmount(run.deposit, session.collateralDecimals ?? 18)} ${session.collateralSymbol ?? "sDAI"}`;

  const estimates = useSessionEstimates(session.parentMarket);
  const selected = selectedEstimates(session.options, estimates, marketEstimates);
  const isDisabled = selected.length === 0 || status !== "trading" || !address;
  const blocker = predictBlocker({
    status,
    options: session.options,
    marketEstimates,
    isMarketUnknown,
    selectedCount: selected.length,
    isConnected: Boolean(address),
  });
  const changed = selected.filter(
    (estimate) => placed?.owner !== address || placed?.values[estimate.scale.market.toLowerCase()] !== estimate.value,
  );
  // with nothing changed, the same estimates can still be backed with more funds
  const toPredict = changed.length > 0 ? changed : selected;

  const predictButton = (
    <Button
      icon={<CheckOutline className="[&_path]:fill-klerosUIComponentsWhiteBackground mr-2 size-4" />}
      text={
        selected.length > 0
          ? `Predict ${selected.length} ${selected.length === 1 ? "estimate" : "estimates"}`
          : "Predict estimates"
      }
      isDisabled={isDisabled}
      onPress={() => setOpened(toPredict)}
    />
  );

  return (
    <SectionCard
      className={clsx(
        "p-4 md:px-8",
        "flex flex-wrap items-start justify-start gap-x-8 gap-y-4",
        "md:flex-row md:items-center md:justify-between",
      )}
    >
      <h3 className="text-fs-text-primary text-base font-semibold">Place your estimates</h3>
      {/* without a wallet the button stays put and disabled; the blocker line says to connect */}
      {address ? <EnsureChain>{predictButton}</EnsureChain> : predictButton}
      {blocker ? (
        <p className="text-fs-text-secondary w-full text-sm">
          {blockerText(blocker, optionNoun(session.itemNamePlural))}
        </p>
      ) : null}

      {interrupted ? (
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className="text-fs-text-secondary text-sm">
            {`A prediction with a deposit of ${depositShown(interrupted)} did not finish.`}
            {isPending ? " A transaction from it may still be pending." : null}
          </p>
          <div className="flex gap-3">
            {isPending ? null : <Button small variant="secondary" text="Discard" onPress={discard} />}
            <Button small text="Resume" onPress={() => setOpened(toPredict)} />
          </div>
        </div>
      ) : null}

      {/* outside the chain gate, so a wallet switching away mid-run does not unmount the run */}
      {isOpen ? (
        <PredictRunner
          session={session}
          selected={opened}
          onClose={() => setOpened(undefined)}
          onSuccess={(skipped: Address[], run: PlacedPrediction) => {
            if (address) {
              const traded = opened.filter((estimate) => !skipped.includes(estimate.scale.market));
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
              session.options.filter((option) => skipped.includes(option.market)).map((option) => option.name),
            );
            setPlacedRun(run);
            setOpened(undefined);
            setIsSuccessOpen(true);
          }}
        />
      ) : null}
      {isSuccessOpen ? (
        <PredictSuccessDialog isOpen placed={placedRun} leftOut={leftOut} onClose={() => setIsSuccessOpen(false)} />
      ) : null}
    </SectionCard>
  );
}

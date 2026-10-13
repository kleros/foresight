"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { Button } from "@kleros/ui-components-library";
import clsx from "clsx";
import { formatUnits, type Address } from "viem";
import { useAccount } from "wagmi";

import type { PredictSnapshot } from "@/features/predict/flow/types";
import { discardRun, findInterruptedRun, hasPendingTransaction } from "@/features/predict/run/interrupted";
import { useSessionEstimates } from "@/features/predict/stores/estimateStore";
import { selectedEstimates } from "@/features/predict/utils/estimates";
import type { SessionDetail, SessionStatus } from "@/features/sessions/types";

import { SectionCard } from "@/components/ui/SectionCard";
import EnsureChain from "@/components/wallet/EnsureChain";

import CheckOutline from "@/assets/svg/check-outline-button.svg";

import { createRunStore } from "@/lib/flowRunStore";

import { type PredictBlocker, predictBlocker } from "./predictBlocker";

// The run pulls in the orchestrator, the quoter and a chain client; none of that belongs on the
// page until someone asks to predict.
const PredictRunner = dynamic(() => import("./PredictRunner").then((module) => module.PredictRunner), { ssr: false });

const PredictSuccessDialog = dynamic(
  () => import("./PredictSuccessDialog").then((module) => module.PredictSuccessDialog),
  { ssr: false },
);

const BLOCKER_TEXT: Record<PredictBlocker, string> = {
  closed: "Trading has closed for this session.",
  "no-liquidity": "This option has no liquidity yet, so it can't be predicted.",
  "no-move": "Move an estimate away from the market estimate to make a prediction.",
};

interface PredictCardProps {
  session: SessionDetail;
  status: SessionStatus;
  marketEstimates: Record<string, number | undefined>;
  /** True while the market numbers are loading or failed; an empty `marketEstimates` says nothing then. */
  isMarketUnknown?: boolean;
}

export function PredictCard({ session, status, marketEstimates, isMarketUnknown = false }: PredictCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSuccessOpen, setIsSuccessOpen] = useState(false);
  const [leftOut, setLeftOut] = useState<string[]>([]);
  const { address } = useAccount();
  // what this page last placed, by owner and lower-case market
  const [placed, setPlaced] = useState<{ owner: Address; values: Record<string, number> }>();
  const [interrupted, setInterrupted] = useState<PredictSnapshot | null>(null);
  const [isPending, setIsPending] = useState(false);

  // read after mount: the stored run lives in this browser, and the popup may have finished or discarded it
  useEffect(() => {
    const store = createRunStore();
    setInterrupted(address && !isOpen ? findInterruptedRun(store, session.id, address) : null);
    setIsPending(address && !isOpen ? hasPendingTransaction(store, session.id, address) : false);
  }, [address, isOpen, session.id]);

  const discard = () => {
    if (address) discardRun(createRunStore(), session.id, address);
    setInterrupted(null);
  };

  const estimates = useSessionEstimates(session.parentMarket);
  const selected = selectedEstimates(session.options, estimates, marketEstimates);
  const isDisabled = selected.length === 0 || status !== "trading";
  const blocker = predictBlocker({
    status,
    options: session.options,
    marketEstimates,
    isMarketUnknown,
    selectedCount: selected.length,
  });
  const changed = selected.filter(
    (estimate) => placed?.owner !== address || placed?.values[estimate.scale.market.toLowerCase()] !== estimate.value,
  );
  // with nothing changed, the same estimates can still be backed with more funds
  const toPredict = changed.length > 0 ? changed : selected;

  return (
    <SectionCard
      className={clsx(
        "p-4 md:px-8",
        "flex flex-wrap items-start justify-center gap-x-8 gap-y-4",
        "md:flex-row md:items-center md:justify-between",
      )}
    >
      <h3 className="text-fs-text-primary text-base font-semibold">Predict all the estimates above</h3>
      <EnsureChain>
        <Button
          icon={
            <CheckOutline
              className={clsx(
                "mr-2 size-4",
                isDisabled
                  ? "[&_path]:fill-klerosUIComponentsStroke"
                  : "[&_path]:fill-klerosUIComponentsWhiteBackground",
              )}
            />
          }
          text="Predict selected"
          isDisabled={isDisabled}
          onPress={() => setIsOpen(true)}
        />
      </EnsureChain>
      {blocker ? <p className="text-fs-text-secondary w-full text-sm">{BLOCKER_TEXT[blocker]}</p> : null}

      {interrupted ? (
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className="text-fs-text-secondary text-sm">
            Your last prediction did not finish. Deposit:{" "}
            {formatUnits(interrupted.deposit, interrupted.depositNative ? 18 : (session.collateralDecimals ?? 18))}{" "}
            {interrupted.depositNative ? "xDAI" : (session.collateralSymbol ?? "sDAI")}
            {isPending ? ". A transaction from it may still be pending; resume to check it." : null}
          </p>
          <div className="flex gap-3">
            {isPending ? null : <Button small variant="secondary" text="Discard" onPress={discard} />}
            <Button small text="Resume" onPress={() => setIsOpen(true)} />
          </div>
        </div>
      ) : null}

      {/* outside the chain gate, so a wallet switching away mid-run does not unmount the run */}
      {isOpen ? (
        <PredictRunner
          session={session}
          selected={toPredict}
          onClose={() => setIsOpen(false)}
          onSuccess={(skipped: Address[]) => {
            if (address) {
              const traded = toPredict.filter((estimate) => !skipped.includes(estimate.scale.market));
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
            setIsOpen(false);
            setIsSuccessOpen(true);
          }}
        />
      ) : null}
      {isSuccessOpen ? <PredictSuccessDialog isOpen leftOut={leftOut} onClose={() => setIsSuccessOpen(false)} /> : null}
    </SectionCard>
  );
}

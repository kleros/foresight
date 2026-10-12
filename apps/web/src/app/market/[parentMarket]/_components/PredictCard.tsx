"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { Button } from "@kleros/ui-components-library";
import clsx from "clsx";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";

import type { PredictSnapshot } from "@/features/predict/flow/types";
import { findInterruptedRun, predictFlowId } from "@/features/predict/run/interrupted";
import { useSessionEstimates } from "@/features/predict/stores/estimateStore";
import { selectedEstimates } from "@/features/predict/utils/estimates";
import type { SessionDetail, SessionStatus } from "@/features/sessions/types";

import { SectionCard } from "@/components/ui/SectionCard";
import EnsureChain from "@/components/wallet/EnsureChain";

import CheckOutline from "@/assets/svg/check-outline-button.svg";

import { createRunStore } from "@/lib/flowRunStore";

// The run pulls in the orchestrator, the quoter and a chain client; none of that belongs on the
// page until someone asks to predict.
const PredictRunner = dynamic(() => import("./PredictRunner").then((module) => module.PredictRunner), { ssr: false });

const PredictSuccessDialog = dynamic(
  () => import("./PredictSuccessDialog").then((module) => module.PredictSuccessDialog),
  { ssr: false },
);

interface PredictCardProps {
  session: SessionDetail;
  status: SessionStatus;
  marketEstimates: Record<string, number | undefined>;
}

export function PredictCard({ session, status, marketEstimates }: PredictCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSuccessOpen, setIsSuccessOpen] = useState(false);
  const { address } = useAccount();
  const [interrupted, setInterrupted] = useState<PredictSnapshot | null>(null);

  // read after mount: the stored run lives in this browser, and the popup may have finished or discarded it
  useEffect(() => {
    setInterrupted(address && !isOpen ? findInterruptedRun(createRunStore(), session.id, address) : null);
  }, [address, isOpen, session.id]);

  const discard = () => {
    createRunStore().clear(predictFlowId(session.id));
    setInterrupted(null);
  };

  const estimates = useSessionEstimates(session.parentMarket);
  const selected = selectedEstimates(session.options, estimates, marketEstimates);
  const isDisabled = selected.length === 0 || status !== "trading";

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

      {interrupted ? (
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className="text-fs-text-secondary text-sm">
            Your last prediction did not finish. Deposit:{" "}
            {formatUnits(interrupted.deposit, interrupted.depositNative ? 18 : (session.collateralDecimals ?? 18))}{" "}
            {interrupted.depositNative ? "xDAI" : (session.collateralSymbol ?? "sDAI")}
          </p>
          <div className="flex gap-3">
            <Button small variant="secondary" text="Discard" onPress={discard} />
            <Button small text="Resume" onPress={() => setIsOpen(true)} />
          </div>
        </div>
      ) : null}

      {/* outside the chain gate, so a wallet switching away mid-run does not unmount the run */}
      {isOpen ? (
        <PredictRunner
          session={session}
          selected={selected}
          onClose={() => setIsOpen(false)}
          onSuccess={() => {
            setIsOpen(false);
            setIsSuccessOpen(true);
          }}
        />
      ) : null}
      {isSuccessOpen ? <PredictSuccessDialog isOpen onClose={() => setIsSuccessOpen(false)} /> : null}
    </SectionCard>
  );
}

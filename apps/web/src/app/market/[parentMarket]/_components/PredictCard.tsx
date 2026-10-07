"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@kleros/ui-components-library";
import clsx from "clsx";

import { useSessionEstimates } from "@/features/predict/stores/estimateStore";
import { selectedEstimates } from "@/features/predict/utils/estimates";
import type { SessionDetail } from "@/features/sessions/types";

import { SectionCard } from "@/components/ui/SectionCard";

// The run pulls in the orchestrator, the quoter and a chain client; none of that belongs on the
// page until someone asks to predict.
const PredictRunner = dynamic(() => import("./PredictRunner").then((module) => module.PredictRunner), { ssr: false });

interface PredictCardProps {
  session: SessionDetail;
  marketEstimates: Record<string, number | undefined>;
}

export function PredictCard({ session, marketEstimates }: PredictCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  const estimates = useSessionEstimates(session.parentMarket);
  const selected = selectedEstimates(session.options, estimates, marketEstimates);

  return (
    <SectionCard
      className={clsx(
        "p-4 md:px-8",
        "flex flex-wrap items-start justify-center gap-x-8 gap-y-4",
        "md:flex-row md:items-center md:justify-between",
      )}
    >
      <h3 className="text-fs-text-primary text-base font-semibold">Predict all the estimates above</h3>
      <Button text="Predict selected" isDisabled={selected.length === 0} onPress={() => setIsOpen(true)} />

      {isOpen ? <PredictRunner session={session} selected={selected} onClose={() => setIsOpen(false)} /> : null}
    </SectionCard>
  );
}

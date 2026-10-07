"use client";

import { useState } from "react";

import { Button, CustomTimeline, NumberField } from "@kleros/ui-components-library";
import clsx from "clsx";

import { Dialog } from "@/components/ui/Dialog";
import { ForesightIcon, type ForesightIconName } from "@/components/ui/ForesightIcon";
import LightButton from "@/components/ui/LightButton";

import { formatAmount, scaleAmount } from "@/utils/amount";
import { formatEstimate } from "@/utils/formatEstimate";

import type { PredictProgress } from "../run/types";
import type { SelectedEstimate } from "../types";

export interface PredictFunds {
  /** What the visitor can spend, in the token named by `symbol`. */
  balance: bigint;
  symbol: string;
  decimals: number;
  /** True while the balance is still being read, when showing zero would be a lie. */
  isPending: boolean;
}

interface PredictDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selected: SelectedEstimate[];
  funds: PredictFunds;
  /** Absent while nothing has been started. */
  progress: PredictProgress | null;
  /** What the visitor has to do before this prediction can be made, if anything. */
  notice?: string;
  onRemove: (market: string) => void;
  onConfirm: (amount: bigint) => void;
  onRetry: () => void;
}

export function PredictDialog({
  isOpen,
  onClose,
  selected,
  funds,
  progress,
  notice,
  onRemove,
  onConfirm,
  onRetry,
}: PredictDialogProps) {
  const [amount, setAmount] = useState(0);

  const running = progress !== null && progress.stage !== "idle";
  const settled = progress?.stage === "complete" || progress?.stage === "halted";
  const spend = scaleAmount(amount, funds.decimals);
  const tooMuch = spend > funds.balance;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={running ? "Making your prediction" : "Confirm your prediction"}
      hint={
        running
          ? "Each step needs one signature. Leave this open until it is done."
          : `${selected.length} ${selected.length === 1 ? "estimate" : "estimates"}, and what you want to put behind them.`
      }
      className="w-full md:w-162"
      // leaving part way through would abandon a run whose transactions are already on chain
      isDismissable={!running || settled}
    >
      {notice !== undefined && !running ? (
        <>
          <p className="text-fs-text-secondary text-sm">{notice}</p>
          <div className="flex justify-end">
            <Button text="Close" variant="secondary" onPress={onClose} />
          </div>
        </>
      ) : running ? (
        <RunState progress={progress} onRetry={onRetry} onClose={onClose} />
      ) : (
        <>
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {selected.map((estimate) => (
              <li
                key={estimate.scale.market}
                className="bg-fs-surface-sunken rounded-fs flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2 flex-none rounded-full"
                    style={{ backgroundColor: estimate.scale.color }}
                    aria-hidden
                  />
                  <span className="text-fs-text-primary min-w-0 text-sm wrap-break-word">{estimate.scale.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={clsx(
                      "text-sm font-semibold",
                      estimate.direction === "higher" ? "text-fs-tone-success" : "text-fs-tone-error",
                    )}
                  >
                    {estimate.direction === "higher" ? "↑" : "↓"} {formatEstimate(estimate.value, estimate.scale.unit)}
                  </span>
                  <LightButton
                    small
                    text="Remove"
                    className="[&_.button-text]:text-fs-text-secondary [&_.button-text]:text-xs"
                    onPress={() => onRemove(estimate.scale.market)}
                  />
                </div>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <NumberField
              label="Amount"
              value={amount}
              minValue={0}
              onChange={(next) => setAmount(Number.isNaN(next) ? 0 : next)}
              formatOptions={{ maximumFractionDigits: 6 }}
              className="w-56"
            />
            <p className="text-fs-text-secondary pb-2 text-sm">
              {funds.isPending
                ? "Checking what you have"
                : `You have ${formatAmount(funds.balance, funds.decimals)} ${funds.symbol}`}
            </p>
          </div>

          {tooMuch ? <p className="text-fs-tone-error text-sm">That is more than you have.</p> : null}

          <div className="flex justify-end gap-2">
            <Button text="Cancel" variant="secondary" onPress={onClose} />
            <Button
              text="Predict"
              isDisabled={selected.length === 0 || tooMuch || funds.isPending}
              onPress={() => onConfirm(spend)}
            />
          </div>
        </>
      )}
    </Dialog>
  );
}

/** The chain's own errors name gas and contracts, which the popup never shows. */
const FAILURE_COPY: Record<NonNullable<PredictProgress["failure"]>["reason"], string> = {
  rejected: "You turned the request down.",
  cancelled: "Your wallet replaced the request with something else.",
  reverted: "The trade could not go through at these prices.",
  rpc: "The network did not answer in time.",
  unknown: "Something went wrong.",
};

type StepState = PredictProgress["steps"][number]["state"];

/** A step is marked the way the deploy screen marks its stages, so one meaning has one look. */
const STEP_BULLET: Record<StepState, { icon: ForesightIconName; className: string }> = {
  pending: { icon: "empty", className: "text-fs-text-secondary" },
  running: { icon: "pending", className: "text-fs-text-primary" },
  success: { icon: "check", className: "text-fs-tone-success" },
  error: { icon: "cross", className: "text-fs-tone-error" },
};

/** Defined once per state: a component built per render is a new type on every pass. */
const BULLETS = Object.fromEntries(
  Object.entries(STEP_BULLET).map(([state, { icon, className }]) => [
    state,
    () => <ForesightIcon name={icon} size={16} className={className} style={{ flex: "none" }} />,
  ]),
) as Record<StepState, () => React.ReactNode>;

function RunState({
  progress,
  onRetry,
  onClose,
}: {
  progress: PredictProgress;
  onRetry: () => void;
  onClose: () => void;
}) {
  const done = progress.stage === "complete";
  const halted = progress.stage === "halted";

  // the timeline takes a non-empty tuple, and a run with no steps has nothing to say
  const [first, ...rest] = progress.steps.map((step) => ({
    title: step.label,
    party: step.state === "running" ? subLine(progress) : "",
    subtitle: "",
    Icon: BULLETS[step.state],
    state: step.state === "success" ? ("disabled" as const) : undefined,
  }));

  return (
    <>
      {first ? (
        <div className="fs-narrative" role="status" aria-live="polite">
          <CustomTimeline items={[first, ...rest]} />
        </div>
      ) : null}

      {progress.skipped.length > 0 ? (
        <p className="text-fs-text-secondary text-sm">
          {progress.skipped.length} of your estimates could not be traded right now and were left out.
        </p>
      ) : null}

      {halted ? (
        <div className="flex flex-col gap-2">
          <p className="text-fs-text-primary text-sm">
            {progress.batchesDone > 0
              ? `${progress.batchesDone} of ${progress.batches} predictions went through. The rest did not.`
              : "Your prediction did not go through."}
          </p>
          <p className="text-fs-text-secondary text-sm">
            Nothing is stuck. Your money is in your trade wallet and you can try the rest whenever you like.
          </p>
          {progress.failure ? (
            <p className="text-fs-tone-error text-sm">{FAILURE_COPY[progress.failure.reason]}</p>
          ) : null}
        </div>
      ) : null}

      {done ? <p className="text-fs-text-primary text-sm">Done. Your estimates are on the market.</p> : null}

      <div className="flex justify-end gap-2">
        {halted && progress.failure?.retryable ? <Button text="Try the rest" onPress={onRetry} /> : null}
        {done || halted ? <Button text="Close" variant={done ? "primary" : "secondary"} onPress={onClose} /> : null}
      </div>
    </>
  );
}

function subLine(progress: PredictProgress): string {
  switch (progress.stage) {
    case "quoting":
      return "finding the best prices";
    case "signing":
      return "waiting for your signature";
    case "confirming":
      return "confirming on chain";
    default:
      return "";
  }
}

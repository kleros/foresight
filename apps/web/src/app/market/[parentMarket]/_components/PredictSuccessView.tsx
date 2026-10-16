"use client";

import type { ReactNode } from "react";

import { Modal, TextField } from "@kleros/ui-components-library";
import clsx from "clsx";

import { PredictButton } from "@/features/predict/components/PredictButton";
import { leftOutText } from "@/features/predict/utils/predictSteps";

import InfoCard from "@/components/ui/InfoCard";

/** The success dialog as drawn, with the email sign-up passed in, so it renders without the wallet or Atlas. */
export function PredictSuccessView({
  isOpen,
  leftOut,
  onClose,
  subscribed,
  email,
  signUp,
}: {
  isOpen: boolean;
  /** Names of the options the run could not trade and left out. */
  leftOut: string[];
  onClose: () => void;
  /** The visitor already gets resolution emails. */
  subscribed: boolean;
  email?: string;
  /** Shown to a visitor not yet subscribed. */
  signUp: ReactNode;
}) {
  return (
    <Modal
      ariaLabel="Prediction placed"
      isOpen={isOpen}
      isDismissable
      onOpenChange={(open) => (open ? undefined : onClose())}
      className={clsx(
        "h-fit max-h-[calc(100dvh-32px)] w-[calc(100vw-2rem)] max-w-[440px] overflow-y-auto",
        "flex flex-col gap-5 p-5 sm:p-6",
        "fs-aurora rounded-fs-popup bg-fs-surface border border-(--fs-popup-edge) shadow-(--fs-popup-shadow)",
      )}
    >
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <span data-testid="success-mark" className="predict-success-mark" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" className="size-7">
            <path
              d="M5.5 12.5l4.5 4.5 8.5-10"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h1 className="text-fs-popup-text text-xl font-semibold tracking-[-0.01em] text-balance">Prediction placed</h1>
        {leftOut.length > 0 ? (
          <p className="text-fs-popup-text-2 text-[13px] leading-[18px] text-pretty">
            {leftOutText(leftOut.length)}: {leftOut.join(", ")}.
          </p>
        ) : null}
      </div>

      <section className="rounded-fs-panel bg-fs-popup-panel flex flex-col gap-3 p-4">
        {subscribed ? (
          <>
            <p className="text-fs-popup-text text-sm font-medium">You&apos;ll get an email when the market resolves.</p>
            {email ? (
              <TextField
                isDisabled
                value={email}
                className={clsx(
                  "w-full [&>label]:hidden [&_input]:rounded-fs-control [&_input]:text-sm",
                  "[&_input]:bg-fs-surface [&_input]:border-(--fs-popup-line)",
                )}
                label="Email"
              />
            ) : null}
            <InfoCard
              className="text-fs-popup-text-2 w-fit text-[13px] leading-[18px] wrap-break-word"
              msg="Change this in Settings. Make sure your email is confirmed."
            />
          </>
        ) : (
          <>
            <h2 className="text-fs-popup-text text-sm font-semibold">Get an email when the market resolves</h2>
            <div className="flex flex-col items-center">{signUp}</div>
          </>
        )}
      </section>

      {/* a visitor not yet subscribed has signing up as the action, so Close steps back */}
      <PredictButton text="Close" quiet={!subscribed} isDisabled={false} onPress={onClose} />
    </Modal>
  );
}

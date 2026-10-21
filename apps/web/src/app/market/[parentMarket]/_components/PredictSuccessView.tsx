"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import type { Address } from "viem";

import { Modal } from "@kleros/ui-components-library";
import clsx from "clsx";

import { PredictButton } from "@/features/predict/components/PredictButton";
import { shownAmount } from "@/features/predict/utils/funding";
import type { FundsToAdd } from "@/features/predict/utils/predictSteps";
import type { PlacedStep } from "@/features/predict/utils/receipt";

import { paths } from "@/config/paths";

/** What a finished run placed, for the line under the dialog's title. */
export interface PlacedPrediction {
  /** Estimates traded, not counting any the run left out. */
  estimates: number;
  /** What the visitor paid, in `symbol`; absent when nothing was paid. */
  amount?: bigint;
  symbol: string;
  decimals: number;
  /** The run's steps in order, as they settled. */
  steps?: PlacedStep[];
  /** What the funds step added, as the run's timeline said it. */
  funds?: FundsToAdd;
  /** The trade wallet the run traded from. */
  wallet?: Address;
}

/** "2 estimates · 10 sDAI", or "2 of 4 estimates · 10 sDAI" when `leftOut` more could not be traded. */
export function placedText({ estimates, amount, symbol, decimals }: PlacedPrediction, leftOut = 0): string {
  const total = estimates + leftOut;
  const count = `${leftOut > 0 ? `${estimates} of ${total}` : estimates} ${total === 1 ? "estimate" : "estimates"}`;
  return amount ? `${count} · ${shownAmount(amount, decimals)} ${symbol}` : count;
}

/** The success dialog as drawn, with the email sign-up passed in, so it renders without the wallet or Atlas. */
export function PredictSuccessView({
  isOpen,
  placed,
  leftOut,
  onClose,
  subscribed,
  email,
  isEmailVerified,
  signUp,
}: {
  isOpen: boolean;
  placed?: PlacedPrediction;
  /** Names of the options the run could not trade and left out. */
  leftOut: string[];
  onClose: () => void;
  /** The visitor already gets resolution emails. */
  subscribed: boolean;
  email?: string;
  isEmailVerified?: boolean;
  /** Shown to a visitor not yet subscribed, as the panel's own control. */
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
        "flex flex-col p-5 sm:p-6",
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
        {placed ? (
          <p className="text-fs-popup-text-2 -mt-1 text-sm tabular-nums">{placedText(placed, leftOut.length)}</p>
        ) : null}
        {leftOut.length > 0 ? (
          <p className="text-fs-popup-text-2 text-[13px] leading-[18px] text-pretty">
            Could not be traded: {leftOut.join(", ")}.
          </p>
        ) : null}
      </div>

      <section className="predict-success-panel rounded-fs-panel bg-fs-popup-panel mt-6 flex flex-col gap-3 p-4">
        {subscribed ? (
          <>
            <p className="text-fs-popup-text text-sm text-pretty">
              {email ? (
                <>
                  You&apos;ll get an email at <b className="font-semibold wrap-anywhere">{email}</b> when the market
                  resolves.
                </>
              ) : (
                "You'll get an email when the market resolves."
              )}
            </p>
            {isEmailVerified === false ? (
              <p className="text-fs-tone-warning-text text-[13px] leading-[18px]">
                Confirm your email first, or it will not arrive.
              </p>
            ) : null}
            <Link
              href={paths.settings.getHref("notifications")}
              className={clsx(
                "text-fs-popup-accent-text w-fit text-[13px] leading-[18px] font-medium",
                "underline decoration-current/40 underline-offset-3",
              )}
            >
              {isEmailVerified === false ? "Confirm in Settings" : "Change in Settings"}
            </Link>
          </>
        ) : (
          <>
            <h2 className="text-fs-popup-text text-sm font-semibold">Get an email when the market resolves</h2>
            <div className="flex flex-col items-center">{signUp}</div>
          </>
        )}
      </section>

      {subscribed ? (
        <div className="mt-4">
          {/* nothing is at stake here, so Close stays in the panel's tone */}
          <PredictButton text="Close" quiet isDisabled={false} onPress={onClose} />
        </div>
      ) : (
        <button
          type="button"
          onClick={onClose}
          className={clsx(
            "text-fs-popup-text-2 rounded-fs-control mt-4 h-11 cursor-pointer self-center px-4 text-sm font-semibold",
            "transition-colors duration-(--fs-dur-echo) ease-(--fs-ease-enter) [@media(hover:hover)]:hover:bg-fs-popup-hover",
          )}
        >
          Close
        </button>
      )}
    </Modal>
  );
}

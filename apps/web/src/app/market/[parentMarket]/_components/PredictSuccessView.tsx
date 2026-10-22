"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import clsx from "clsx";
import type { Address, Hash } from "viem";

import { PredictButton } from "@/features/predict/components/PredictButton";
import { StepBullet } from "@/features/predict/components/StepBullet";
import { shownAmount } from "@/features/predict/utils/funding";
import type { FundsToAdd } from "@/features/predict/utils/predictSteps";
import { receiptRows, type PlacedStep, type ReceiptLink, type ReceiptRow } from "@/features/predict/utils/receipt";

import { Modal } from "@/components/ui/Modal";

import ExternalArrow from "@/assets/svg/external-arrow.svg";

import { shortHash } from "@/utils/hash";

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

function TxLink({ link }: { link: ReceiptLink }) {
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${link.label}, ${shortHash(link.hash)}`}
      title={link.hash}
      className={clsx(
        "text-fs-popup-text-2 rounded-fs-control inline-flex h-8 min-w-8 items-center justify-center gap-0.5 px-1",
        // under 360px three batch links leave a step's title its one line
        "max-[359px]:min-w-7 max-[359px]:px-0.5",
        // a 44px tall target over the 32px it draws; neighbours sit side by side, so it grows only up and down
        "relative before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']",
        "text-[13px] font-medium tabular-nums",
        "transition-colors duration-(--fs-dur-echo) ease-(--fs-ease-enter)",
        "[@media(hover:hover)]:hover:text-fs-popup-accent-text [@media(hover:hover)]:hover:bg-fs-popup-hover",
      )}
    >
      {link.text}
      <ExternalArrow className="size-4 shrink-0 max-[359px]:size-3.5 [&_path]:fill-current" aria-hidden />
    </a>
  );
}

/** The run's timeline, finished: a done bullet per step on the axis connector, its figure, and its links. */
function Receipt({ rows }: { rows: ReceiptRow[] }) {
  const anyLinked = rows.some((row) => row.links.length > 0);
  return (
    <ol aria-label="Transactions" className="predict-receipt mt-5 flex flex-col gap-2">
      {rows.map((row, index) => (
        <li
          key={row.id}
          className="fs-enter flex min-h-10 items-center gap-2.5"
          style={{ "--i": index } as CSSProperties}
        >
          <StepBullet view="done" number={index + 1} />
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-fs-popup-text text-sm leading-5 font-semibold">{row.title}</span>
            {row.detail ? (
              // ml-auto keeps a detail that wraps under its title on the figures' column
              <span className="text-fs-popup-text-2 ml-auto text-[13px] leading-[18px] tabular-nums">{row.detail}</span>
            ) : null}
          </div>
          {row.links.length > 0 ? (
            <span className="-mr-1.5 flex shrink-0 items-center">
              {row.links.map((link) => (
                <TxLink key={link.hash} link={link} />
              ))}
            </span>
          ) : anyLinked ? (
            // an unlinked row keeps the link's slot, so every figure ends on one column
            <span className="-mr-1.5 size-8 shrink-0 max-[359px]:w-7" aria-hidden />
          ) : null}
        </li>
      ))}
    </ol>
  );
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
  optionNoun,
  txUrl,
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
  /** What the market calls one option, for where the position shows. */
  optionNoun: string;
  /** A transaction's explorer page; undefined on a chain with none. */
  txUrl: (hash: Hash) => string | undefined;
}) {
  const rows = placed
    ? receiptRows({ steps: placed.steps ?? [], funds: placed.funds, wallet: placed.wallet, txUrl })
    : [];
  return (
    <Modal
      ariaLabel="Prediction successful"
      isOpen={isOpen}
      isDismissable
      onOpenChange={(open) => (open ? undefined : onClose())}
      className={clsx(
        "h-fit max-h-[calc(100dvh-32px)] w-[calc(100vw-2rem)] max-w-[440px] overflow-y-auto",
        "flex flex-col p-5 sm:p-6",
        "fs-aurora rounded-fs-popup bg-fs-surface border border-(--fs-popup-edge) shadow-(--fs-popup-shadow)",
      )}
    >
      <div className="flex flex-col">
        <h1 className="text-fs-popup-text text-xl font-semibold tracking-[-0.01em]">Prediction successful</h1>
        <div className="mt-1 flex flex-col gap-1">
          {placed ? (
            <p className="text-fs-popup-text-2 text-sm tabular-nums">{placedText(placed, leftOut.length)}</p>
          ) : null}
          <p className="text-fs-popup-text-2 text-[13px] leading-[18px]">See your position under each {optionNoun}.</p>
        </div>
        {rows.length > 0 ? <Receipt rows={rows} /> : null}
        {leftOut.length > 0 ? (
          <p className="text-fs-popup-text-2 mt-3 text-[13px] leading-[18px] text-pretty">
            Could not be traded: {leftOut.join(", ")}.
          </p>
        ) : null}
      </div>

      <section className="predict-success-panel rounded-fs-panel bg-fs-popup-panel mt-5 flex flex-col gap-3 p-4">
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

      {/* on a phone on its side Close holds the dialog's foot, as the popup's button does */}
      <div className="predict-success-foot mt-4 flex flex-col">
        {subscribed ? (
          // nothing is at stake here, so Close stays in the panel's tone
          <PredictButton text="Close" quiet isDisabled={false} onPress={onClose} />
        ) : (
          <button
            type="button"
            onClick={onClose}
            className={clsx(
              "text-fs-popup-text-2 rounded-fs-control h-11 cursor-pointer self-center px-4 text-sm font-semibold",
              "transition-colors duration-(--fs-dur-echo) ease-(--fs-ease-enter) [@media(hover:hover)]:hover:bg-fs-popup-hover",
            )}
          >
            Close
          </button>
        )}
      </div>
    </Modal>
  );
}

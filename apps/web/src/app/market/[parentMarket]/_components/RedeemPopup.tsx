"use client";

import { useEffect, useId, useState } from "react";

import { Button } from "@kleros/ui-components-library";
import clsx from "clsx";
import { isAddressEqual, type Address } from "viem";

import type { ParentResolution } from "@/features/resolution/api/getSessionResolution";
import type { SessionKey } from "@/features/resolution/api/useSessionResolution";
import { PnlFigure } from "@/features/resolution/components/PnlFigure";
import type { RedeemPart } from "@/features/resolution/redeem/plan";
import type { RedeemFailureReason, RedeemProgress } from "@/features/resolution/redeem/run";
import type { RealisedPnl } from "@/features/resolution/utils/realisedPnl";

import { Modal } from "@/components/ui/Modal";
import { POPUP_FRAME, PopupCloseButton } from "@/components/ui/Popup";
import { PopupButton } from "@/components/ui/PopupButton";

import { formatDisplayAmount } from "@/utils/amount";

import { useRedeemFromTradeWallet, useTradeWalletOwner, useTradeWalletRedeem } from "./useTradeWalletRedeem";
import { useWalletRedeem, useWalletRedeemRun, type WalletRedeemRunHandle } from "./useWalletRedeem";

const SDAI_DECIMALS = 18;

/** Every decimal, so the shown payout is what the wallet receives to the wei. */
const sDai = (value: bigint) => `${formatDisplayAmount(value, SDAI_DECIMALS, SDAI_DECIMALS)} sDAI`;

export const START_OVER_WARNING =
  "Reject any redeem prompt still open in your wallet first. Starting over lets go of it, and a new redeem asks again.";

const FAILURE_COPY: Record<RedeemFailureReason, string> = {
  rejected: "You declined the request in your wallet.",
  cancelled: "The transaction was replaced in your wallet, so it did not redeem.",
  reverted: "The transaction failed on chain.",
  rpc: "Could not reach the network.",
  unknown: "Something went wrong with this redeem.",
  unlisted: "Not sent: this redeem does not match what Foresight allows for your account.",
  changed: "What your wallet holds changed since you pressed Redeem. Start over to review it again.",
  "wrong-wallet": "Connect the wallet that started this redeem.",
  "wrong-chain": "Switch your wallet to Gnosis to carry on.",
  pending: "Your wallet has a transaction waiting. Try again once it confirms.",
  held: "A redeem prompt from earlier may still be open in your wallet. Answer it there, or reject it and start over.",
  wallet: "Your wallet could not take the request.",
  storage: "Your browser could not save the redeem, so nothing was sent.",
  elsewhere: "This redeem changed in another tab. Try again to load it here.",
  "batch-unknown":
    "Your wallet cannot report the redeem it was sent. Reject it in your wallet if it is open, then start over.",
  "batch-failed": "Your wallet reports the redeem did not go through.",
  "batch-refused":
    "Your wallet cannot send the redeem in one transaction. Try again to sign it one transaction at a time.",
};

function statusText(progress: RedeemProgress): string | undefined {
  switch (progress.stage) {
    case "signing":
      return "Confirm the redeem in your wallet.";
    case "confirming":
      return "Waiting for the redeem to confirm.";
    case "review":
      return "A redeem from this wallet was left unfinished. Carrying on signs only what is left.";
    case "halted":
      return progress.failure ? FAILURE_COPY[progress.failure.reason] : FAILURE_COPY.unknown;
    default:
      return undefined;
  }
}

interface RedeemOption {
  market: Address;
  outcomeIndex: number;
  name: string;
}

/**
 * One Redeem button once either wallet holds something redeemable (spec D11), and the popup that lists both wallets'
 * parts and redeems both on one press: the trade wallet's batch first, then the connected wallet's run.
 */
export function RedeemPopup({
  session,
  parent,
  parentMarket,
  options,
  pnl,
  noun,
}: {
  session: SessionKey | undefined;
  parent: ParentResolution | Error | undefined;
  parentMarket: Address;
  options: RedeemOption[];
  /** The connected account's realised P&L in the session, as the header shows it. */
  pnl: RealisedPnl | undefined;
  /** Options, as the session names them: `cities`. */
  noun: string;
}) {
  const trade = useTradeWalletRedeem(session, parent);
  const tradeRun = useRedeemFromTradeWallet();
  const wallet = useWalletRedeem(session, parent);
  const walletRun = useWalletRedeemRun(session);
  const [isOpen, setOpen] = useState(false);
  const [payOwner, setPayOwner] = useState(false);
  const tradeOwner = useTradeWalletOwner(trade.owner, payOwner);
  const stage = walletRun.progress?.stage;
  const held = stage !== undefined && stage !== "idle" && stage !== "complete";
  const owner = trade.owner;

  if (!session || !owner) return null;
  if (parent instanceof Error) {
    return <p className="type-label text-fs-text-secondary">Could not read this session&apos;s result.</p>;
  }
  if (!parent?.resolved) return null;

  const tradePlan = trade.data;
  const walletRead = wallet.data;
  const redeemable = Boolean(tradePlan?.tx) || (walletRead?.plan.calls.length ?? 0) > 0;
  const isRunning = tradeRun.isPending || walletRun.isRunning;
  const payTo = payOwner ? tradeOwner.data : undefined;

  const redeem = async () => {
    if (tradePlan?.tx) {
      try {
        await tradeRun.mutateAsync({ shown: tradePlan, owner, session, payTo });
      } catch {
        // the hook says why; the wallet's own redeem waits for a press that can carry both
        return;
      }
    }
    if (walletRead && walletRead.plan.calls.length > 0) walletRun.start(walletRead.input);
  };

  return (
    <>
      {trade.isError ? (
        <ReadFailed text="Could not read what your trade wallet can redeem." onRetry={() => void trade.refetch()} />
      ) : null}
      {wallet.isError && !held ? (
        <ReadFailed text="Could not read what your wallet can redeem." onRetry={() => void wallet.refetch()} />
      ) : null}
      {redeemable || held ? (
        <div className="flex justify-end">
          <Button
            text="Redeem"
            onPress={() => {
              setPayOwner(false);
              setOpen(true);
            }}
          />
        </div>
      ) : null}
      <Modal
        ariaLabel="Redeem"
        isOpen={isOpen}
        isDismissable={!isRunning}
        onOpenChange={(open) => (open || isRunning ? undefined : setOpen(false))}
        className={POPUP_FRAME}
      >
        <div className="landscape-phone:overflow-y-auto relative flex min-h-0 w-full flex-col">
          <div className="bg-fs-surface landscape-phone:sticky landscape-phone:top-0 landscape-phone:z-20 mb-2 flex h-8 shrink-0 items-center justify-between">
            <h2 className="text-fs-popup-text text-lg font-semibold tracking-[-0.01em]">Redeem</h2>
            <PopupCloseButton isDisabled={isRunning} onPress={() => setOpen(false)} />
          </div>

          <div className="landscape-phone:overflow-visible flex min-h-0 flex-col gap-2 overflow-y-auto pt-2 pb-2">
            {tradePlan && (tradePlan.parts.length > 0 || tradePlan.waiting.length > 0) ? (
              <WalletParts
                label="Trade wallet"
                parts={tradePlan.parts}
                waiting={tradePlan.waiting}
                nameOf={(market) => nameOf(market, parentMarket, options)}
                pnl={pnl}
                options={options}
              />
            ) : null}
            {tradePlan?.tx ? (
              <PayOwner
                isTicked={payOwner}
                isLocked={isRunning}
                onChange={setPayOwner}
                owner={tradeOwner.data}
                isUnread={tradeOwner.isError}
                payout={tradePlan.payout}
              />
            ) : null}
            {walletRead && (walletRead.plan.parts.length > 0 || walletRead.plan.waiting.length > 0) ? (
              <WalletParts
                label="Your wallet"
                parts={walletRead.plan.parts}
                waiting={walletRead.plan.waiting}
                nameOf={(market) => nameOf(market, parentMarket, options)}
                options={options}
              />
            ) : null}
            {walletRead && walletRead.plan.calls.length > 0 ? (
              <p className="text-fs-popup-text-2 px-1 text-xs leading-4 break-all tabular-nums">
                {sDai(walletRead.plan.payout)} goes to your wallet.
              </p>
            ) : null}
            {!redeemable && !held ? (
              <p className="text-fs-popup-text-2 px-1 text-sm">Nothing left to redeem in this session.</p>
            ) : null}
            {pnl ? (
              <div className="rounded-fs-panel bg-fs-popup-panel flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 py-3">
                <span className="text-fs-popup-text text-sm font-semibold">This session</span>
                <PnlFigure value={pnl.session.pnl} />
                {pnl.session.waiting.length > 0 ? (
                  <span className="text-fs-popup-text-2 w-full text-xs leading-4">
                    Excludes {noun} waiting for their result.
                  </span>
                ) : null}
              </div>
            ) : null}
            {held ? <RunStatus run={walletRun} /> : null}
          </div>

          <div className="predict-footer bg-fs-surface landscape-phone:pb-2 sticky bottom-0 flex gap-2 pt-2 pb-4 short:pb-3">
            {redeemable && !held ? (
              <PopupButton
                text="Redeem"
                busyText={isRunning ? "Redeeming…" : undefined}
                isDisabled={trade.isFetching || wallet.isFetching || (payOwner && !payTo)}
                onPress={() => void redeem()}
              />
            ) : (
              <PopupButton text="Done" isDisabled={isRunning} onPress={() => setOpen(false)} />
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

const nameOf = (market: Address, parentMarket: Address, options: RedeemOption[]) =>
  isAddressEqual(market, parentMarket)
    ? "Winning outcome tokens"
    : (options.find((option) => isAddressEqual(option.market, market))?.name ?? market);

/** One wallet's redeemable parts, each with its payout and, for the trade wallet, its option's P&L, then its waiting options. */
function WalletParts({
  label,
  parts,
  waiting,
  nameOf,
  pnl,
  options,
}: {
  label: string;
  parts: RedeemPart[];
  waiting: number[];
  nameOf: (market: Address) => string;
  /** Absent for the connected wallet, whose parts show their payout only (spec D16). */
  pnl?: RealisedPnl;
  options: RedeemOption[];
}) {
  const id = useId();
  const pnlOf = (market: Address) => {
    const option = options.find((each) => isAddressEqual(each.market, market));
    const figure = option ? pnl?.options[option.outcomeIndex] : undefined;
    return figure?.status === "settled" ? figure.pnl : undefined;
  };
  return (
    <section className="rounded-fs-panel bg-fs-popup-panel px-4 py-1">
      <h3 id={id} className="type-label text-fs-popup-text-2 pt-2.5 font-medium">
        {label}
      </h3>
      <ul aria-labelledby={id} className="divide-y divide-(--fs-popup-line)">
        {parts.map((part) => {
          const figure = pnlOf(part.market);
          return (
            <li key={part.market} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
              <span className="text-fs-popup-text min-w-0 text-sm font-semibold wrap-anywhere">
                {nameOf(part.market)}
              </span>
              <span className="text-fs-popup-text min-w-0 text-sm break-all tabular-nums">{sDai(part.payout)}</span>
              {figure !== undefined ? <PnlFigure value={figure} /> : null}
            </li>
          );
        })}
        {waiting.map((index) => (
          <li key={`waiting-${index}`} className="flex flex-wrap justify-between gap-x-4 py-2.5 text-sm">
            <span className="text-fs-popup-text min-w-0 font-semibold wrap-anywhere">
              {options.find((option) => option.outcomeIndex === index)?.name ?? `Option ${index + 1}`}
            </span>
            <span className="text-fs-popup-text-2">Waiting for result</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The pay-to-owner box (spec D12): off on every open; ticked, it names the trade wallet's on-chain `owner()`. */
function PayOwner({
  isTicked,
  isLocked,
  onChange,
  owner,
  isUnread,
  payout,
}: {
  isTicked: boolean;
  isLocked: boolean;
  onChange: (isTicked: boolean) => void;
  owner: Address | undefined;
  isUnread: boolean;
  payout: bigint;
}) {
  return (
    <div className="flex flex-col gap-1 px-1">
      <label
        className={clsx(
          // a 44px target on the 20px row
          "group -my-3 flex min-w-0 items-center gap-2 py-3 text-[13px] leading-5 font-medium",
          isLocked ? "text-fs-popup-text-3" : "text-fs-popup-text cursor-pointer",
        )}
      >
        <input
          type="checkbox"
          className="peer sr-only"
          checked={isTicked}
          disabled={isLocked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span
          aria-hidden
          className={clsx(
            "predict-check grid size-4 shrink-0 place-items-center rounded-[5px] border",
            "border-fs-popup-line-strong bg-fs-surface peer-checked:border-transparent",
            !isLocked && "[@media(hover:hover)]:group-hover:border-fs-popup-text-3",
            "peer-focus-visible:ring-fs-focus-ring peer-focus-visible:ring-2 peer-focus-visible:ring-offset-1",
            "peer-focus-visible:ring-offset-fs-popup-panel peer-disabled:opacity-60",
          )}
        >
          <svg viewBox="0 0 10.17 10.17" className="size-2.5" fill="none">
            <path
              d="M1 5.52L3.92 9.17L9.17 1"
              stroke="var(--fs-popup-on-axis)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        Send the trade wallet&apos;s payout to its owner
      </label>
      <p className="text-fs-popup-text-2 text-xs leading-4 break-all tabular-nums">
        {!isTicked
          ? `${sDai(payout)} goes to your trade wallet.`
          : owner
            ? `${sDai(payout)} goes to ${owner}.`
            : isUnread
              ? "Could not read the trade wallet's owner. Untick to redeem into the trade wallet."
              : "Reading the trade wallet's owner…"}
      </p>
    </div>
  );
}

function ReadFailed({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="type-label text-fs-text-secondary">{text}</p>
      <Button small variant="secondary" text="Read again" onPress={onRetry} />
    </div>
  );
}

/** What the connected wallet's run is doing or why it stopped, with the actions that carry it on or let it go. */
function RunStatus({ run }: { run: WalletRedeemRunHandle }) {
  const progress = run.progress!;
  const holdsSend = progress.holdsSend === true;
  const [asking, setAsking] = useState(false);
  // a press answers the stop it was made on, so a later hold asks again
  useEffect(() => {
    if (!holdsSend) setAsking(false);
  }, [holdsSend]);
  const stopped = progress.stage === "halted" || progress.stage === "review";

  if (asking && holdsSend) {
    return (
      <div className="flex flex-col gap-2 px-1">
        <p role="alert" className="type-label text-fs-popup-text-2 text-pretty">
          {START_OVER_WARNING}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button small variant="secondary" text="Back" onPress={() => setAsking(false)} />
          <Button
            small
            text="Start over"
            onPress={() => {
              setAsking(false);
              run.discard();
            }}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 px-1">
      <p role="status" aria-live="polite" className="type-label text-fs-popup-text-2 min-w-48 flex-1 text-pretty">
        {statusText(progress)}
      </p>
      {progress.stage === "review" ? <Button small text="Continue redeem" onPress={run.resume} /> : null}
      {progress.failure?.retryable ? <Button small text="Try again" onPress={run.retry} /> : null}
      {stopped ? (
        <Button
          small
          variant="secondary"
          text="Start over"
          onPress={() => (holdsSend ? setAsking(true) : run.reset())}
        />
      ) : null}
    </div>
  );
}

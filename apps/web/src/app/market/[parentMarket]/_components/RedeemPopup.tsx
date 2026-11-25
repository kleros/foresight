"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "@kleros/ui-components-library";
import clsx from "clsx";
import { isAddressEqual, type Address } from "viem";

import type { ParentResolution } from "@/features/resolution/api/getSessionResolution";
import type { SessionKey } from "@/features/resolution/api/useSessionResolution";
import { PnlFigure, shownSdai } from "@/features/resolution/components/PnlFigure";
import type { RedeemPart } from "@/features/resolution/redeem/plan";
import type { RedeemFailureReason, RedeemProgress } from "@/features/resolution/redeem/run";
import type { RealisedPnl } from "@/features/resolution/utils/realisedPnl";

import { Modal } from "@/components/ui/Modal";
import { POPUP_FRAME, PopupCloseButton } from "@/components/ui/Popup";
import { PopupButton } from "@/components/ui/PopupButton";
import { ScrollFade } from "@/components/ui/ScrollFade";
import { StatusCallout } from "@/components/ui/StatusCallout";
import type { PopupStatusLine } from "@/components/ui/StatusGlyph";
import EnsureChain from "@/components/wallet/EnsureChain";

import {
  useRedeemFromTradeWallet,
  useTradeWalletOwner,
  useTradeWalletRedeem,
  type TradeRedeemStage,
} from "./useTradeWalletRedeem";
import { useWalletRedeem, useWalletRedeemRun, type WalletRedeemRunHandle } from "./useWalletRedeem";

const CENT = 10n ** 16n;
const UNREAD_COPY = "Could not read this session's result.";

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

/** Stops that ask the visitor to act or wait rather than report a failure. */
const WARNING_REASONS: ReadonlySet<RedeemFailureReason> = new Set([
  "changed",
  "wrong-wallet",
  "wrong-chain",
  "pending",
  "held",
  "elsewhere",
  "batch-unknown",
]);

/** What the connected wallet's run is doing or why it stopped; null while it is idle or done. */
function walletStatus(progress: RedeemProgress | null): PopupStatusLine | null {
  switch (progress?.stage) {
    case "signing":
      return { text: "Confirm the redeem in your wallet.", tone: "neutral" };
    case "confirming":
      return { text: "Waiting for the redeem to confirm.", tone: "neutral", waiting: true };
    case "review":
      return {
        text: "A redeem from this wallet was left unfinished. Carrying on signs only what is left.",
        tone: "warning",
      };
    case "halted": {
      const reason = progress.failure?.reason ?? "unknown";
      return { text: FAILURE_COPY[reason], tone: WARNING_REASONS.has(reason) ? "warning" : "error" };
    }
    default:
      return null;
  }
}

const TRADE_STATUS: Record<TradeRedeemStage, PopupStatusLine> = {
  checking: { text: "Checking your trade wallet before you sign.", tone: "neutral", waiting: true },
  signing: { text: "Confirm the trade wallet's redeem in your wallet.", tone: "neutral" },
  confirming: { text: "Waiting for the trade wallet's redeem to confirm.", tone: "neutral", waiting: true },
};

const TRADE_BUSY: Record<TradeRedeemStage, string> = {
  checking: "Checking…",
  signing: "Confirm in your wallet",
  confirming: "Confirming…",
};

interface RedeemOption {
  market: Address;
  outcomeIndex: number;
  name: string;
}

/** What one press set out to redeem, kept so the popup can say what went where once both lists read empty. */
interface Receipt {
  /** `to` is the owner a ticked box paid; absent, the payout stayed in the trade wallet. */
  trade?: { payout: bigint; to?: Address; done: boolean };
  /** `payout` is absent for a stored run carried on, which shows no list of its own. */
  wallet?: { payout?: bigint; moved: boolean; done: boolean };
}

const isDone = (receipt: Receipt | null) =>
  receipt !== null &&
  (receipt.trade !== undefined || receipt.wallet !== undefined) &&
  (receipt.trade?.done ?? true) &&
  (receipt.wallet?.done ?? true);

const receiptTotal = (receipt: Receipt) => (receipt.trade?.payout ?? 0n) + (receipt.wallet?.payout ?? 0n);

/**
 * One Redeem button once either wallet holds something redeemable (spec D11), labelled with what it redeems (D18),
 * and the popup that lists both wallets' parts and redeems both on one press: the trade wallet's batch first, then
 * the connected wallet's run.
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
  // the status line says each stage, as the predict popup's does, so the send raises no toasts over the popup
  const tradeRun = useRedeemFromTradeWallet({ toasts: false });
  const wallet = useWalletRedeem(session, parent);
  const walletRun = useWalletRedeemRun(session);
  const [isOpen, setOpen] = useState(false);
  const [payOwner, setPayOwner] = useState(false);
  const tradeOwner = useTradeWalletOwner(trade.owner, payOwner);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [redeemed, setRedeemed] = useState<bigint | undefined>(undefined);
  const noteRef = useRef<HTMLParagraphElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusNote = useRef(false);
  const lineId = useId();
  const stage = walletRun.progress?.stage;
  const held = stage !== undefined && stage !== "idle" && stage !== "complete";
  const succeeded = isDone(receipt);

  // the wallet's leg is done once its run, started by this press, reaches complete
  const walletLeg = receipt?.wallet;
  useEffect(() => {
    if (!walletLeg || walletLeg.done) return;
    const moving = stage === "signing" || stage === "confirming";
    if (moving && !walletLeg.moved) setReceipt((now) => now && { ...now, wallet: { ...walletLeg, moved: true } });
    if (stage === "complete" && walletLeg.moved) {
      setReceipt((now) => now && { ...now, wallet: { ...walletLeg, done: true } });
    }
  }, [stage, walletLeg]);

  useEffect(() => {
    if (!succeeded || !receipt) return;
    setRedeemed(receiptTotal(receipt));
    // the button that was pressed turns into Done, so focus is put where the result is read
    titleRef.current?.focus();
  }, [succeeded, receipt]);

  useEffect(() => {
    if (isOpen || !focusNote.current) return;
    focusNote.current = false;
    // after the dialog hands focus back to a trigger that is no longer there
    const frame = requestAnimationFrame(() => noteRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  const owner = trade.owner;
  // a failed read keeps an open popup, so a run under way still shows
  const unread = parent instanceof Error;
  const resolved = unread || parent?.resolved === true;
  if (!session || !resolved) return null;
  if (!owner) {
    return trade.isWrongChain ? (
      <div className="ml-auto">
        <EnsureChain>
          <Button text="Redeem" onPress={() => undefined} />
        </EnsureChain>
      </div>
    ) : null;
  }

  const tradePlan = unread ? undefined : trade.data;
  const walletRead = unread ? undefined : wallet.data;
  const walletRedeems = (walletRead?.plan.calls.length ?? 0) > 0;
  const redeemable = Boolean(tradePlan?.tx) || walletRedeems;
  const isRunning = tradeRun.isPending || walletRun.isRunning;
  // a sent redeem is stored, so the popup can be left while it confirms and opened again on it
  const canClose = !tradeRun.isPending && stage !== "signing";
  const payTo = payOwner ? tradeOwner.data : undefined;
  const total = (tradePlan?.tx ? tradePlan.payout : 0n) + (walletRedeems ? walletRead!.plan.payout : 0n);
  const waiting = (tradePlan?.waiting.length ?? 0) + (walletRead?.plan.waiting.length ?? 0);
  const isInvalid = !unread && parent?.resolved === true && parent.invalid;
  const nameOf = (market: Address) => partName(market, parentMarket, options, isInvalid);

  const redeem = async () => {
    const tradeLeg = tradePlan?.tx ? { payout: tradePlan.payout, to: payTo, done: false } : undefined;
    const walletLeg = walletRedeems ? { payout: walletRead!.plan.payout, moved: false, done: false } : undefined;
    setReceipt({ trade: tradeLeg, wallet: walletLeg });
    if (tradePlan?.tx) {
      try {
        await tradeRun.mutateAsync({ shown: tradePlan, owner, session, payTo });
      } catch {
        // the failure shows in the status line; the wallet's own redeem waits for a press that can carry both
        setReceipt(null);
        return;
      }
      setReceipt((now) => now && { ...now, trade: { ...tradeLeg!, done: true } });
    }
    if (walletRedeems) walletRun.start(walletRead!.input);
  };

  const resume = () => {
    setReceipt((now) => ({ ...now, wallet: { payout: now?.wallet?.payout, moved: false, done: false } }));
    walletRun.resume();
  };

  const open = () => {
    setPayOwner(false);
    if (!tradeRun.isPending) tradeRun.reset();
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    if (!succeeded) return;
    setReceipt(null);
    focusNote.current = true;
  };

  const status: PopupStatusLine | null = succeeded
    ? { text: `Redeemed ${payoutText(receiptTotal(receipt!))}.`, tone: "neutral" }
    : tradeRun.isPending
      ? TRADE_STATUS[tradeRun.stage ?? "checking"]
      : held
        ? walletStatus(walletRun.progress)
        : (tradeRun.failure ?? null);

  const ownerLine = !payOwner ? undefined : payTo ? undefined : lineId;

  return (
    <>
      {unread ? <p className="type-label text-fs-text-secondary w-full">{UNREAD_COPY}</p> : null}
      {trade.isError && !unread ? (
        <ReadFailed text="Could not read what your trade wallet can redeem." onRetry={() => void trade.refetch()} />
      ) : null}
      {wallet.isError && !held && !unread ? (
        <ReadFailed text="Could not read what your wallet can redeem." onRetry={() => void wallet.refetch()} />
      ) : null}
      {redeemable || held ? (
        <div className="ml-auto">
          <Button text={total >= CENT ? `Redeem ${shownSdai(total)}` : "Redeem"} onPress={open} />
        </div>
      ) : redeemed !== undefined ? (
        <p
          ref={noteRef}
          tabIndex={-1}
          className="type-label text-fs-text-secondary rounded-fs-control ml-auto tabular-nums"
        >
          Redeemed {payoutText(redeemed)}
        </p>
      ) : null}
      <Modal
        ariaLabel="Redeem"
        isOpen={isOpen}
        isDismissable={canClose}
        onOpenChange={(next) => (next || !canClose ? undefined : close())}
        className={POPUP_FRAME}
      >
        <div className="landscape-phone:overflow-y-auto relative flex min-h-0 w-full flex-col">
          <div className="bg-fs-surface landscape-phone:sticky landscape-phone:top-0 landscape-phone:z-20 mb-2 flex h-8 shrink-0 items-center justify-between">
            <h2
              ref={titleRef}
              tabIndex={-1}
              className="text-fs-popup-text rounded-fs-control text-lg font-semibold tracking-[-0.01em]"
            >
              {succeeded ? "Redeemed" : "Redeem"}
            </h2>
            <PopupCloseButton isDisabled={!canClose} onPress={close} />
          </div>

          <ScrollFade
            className="landscape-phone:min-h-0 landscape-phone:flex-none min-h-24 w-full"
            cue="More below"
            cueTone="border-(--fs-popup-line) text-fs-popup-text-2"
            cueLift={status ? 2 : 3}
            cueDrop={status ? 3 : 6}
            minOverflow={1}
            fadeSize={40}
          >
            <div data-testid="redeem-body" className="flex flex-col gap-2 pt-2 pb-2 short:pt-1">
              {succeeded ? (
                <Redeemed receipt={receipt!} />
              ) : (
                <>
                  {tradePlan && (tradePlan.parts.length > 0 || tradePlan.waiting.length > 0) ? (
                    <WalletParts
                      label="Trade wallet"
                      parts={tradePlan.parts}
                      waiting={tradePlan.waiting}
                      nameOf={nameOf}
                      pnl={pnl}
                      options={options}
                    />
                  ) : null}
                  {tradePlan?.tx ? (
                    <PayOwner
                      lineId={lineId}
                      isTicked={payOwner}
                      isLocked={isRunning}
                      onChange={setPayOwner}
                      owner={tradeOwner.data}
                      isUnread={tradeOwner.isError}
                      payout={tradePlan.payout}
                    />
                  ) : null}
                  {receipt?.trade?.done ? <TradeRedeemed leg={receipt.trade} /> : null}
                  {trade.isError && !unread ? (
                    <ReadFailedInDialog
                      text="Could not read what your trade wallet can redeem. Redeem covers your wallet only."
                      onRetry={() => void trade.refetch()}
                    />
                  ) : null}
                  {walletRead && (walletRead.plan.parts.length > 0 || walletRead.plan.waiting.length > 0) ? (
                    <WalletParts
                      label="Your wallet"
                      parts={walletRead.plan.parts}
                      waiting={walletRead.plan.waiting}
                      nameOf={nameOf}
                      options={options}
                    />
                  ) : null}
                  {walletRedeems ? (
                    <p className="text-fs-popup-text-2 px-1 text-xs leading-4 text-pretty tabular-nums">
                      {payoutText(walletRead!.plan.payout)} goes to your wallet.
                    </p>
                  ) : null}
                  {wallet.isError && !held && !unread ? (
                    <ReadFailedInDialog
                      text="Could not read what your wallet can redeem. Redeem covers your trade wallet only."
                      onRetry={() => void wallet.refetch()}
                    />
                  ) : null}
                  {unread ? <p className="text-fs-popup-text-2 px-1 text-sm">{UNREAD_COPY}</p> : null}
                  {!redeemable && !held && !unread && waiting === 0 && !receipt ? (
                    <p className="text-fs-popup-text-2 px-1 text-sm">Nothing left to redeem in this session.</p>
                  ) : null}
                </>
              )}
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
            </div>
          </ScrollFade>

          {/* outside the body's scroll area, so the reason a run stopped shows with the button */}
          <StatusCallout status={status} />

          <RedeemFooter
            run={walletRun}
            succeeded={succeeded}
            trade={tradeRun}
            onDone={close}
            onResume={resume}
            idle={
              redeemable
                ? {
                    // a send that may still land, or a changed list, asks to check first rather than to retry
                    text: tradeRun.failure?.tone === "error" ? "Try again" : "Redeem",
                    isDisabled: trade.isFetching || wallet.isFetching || (payOwner && !payTo),
                    onPress: () => void redeem(),
                    describedBy: ownerLine,
                  }
                : { text: "Done", isDisabled: false, onPress: close }
            }
          />
        </div>
      </Modal>
    </>
  );
}

/** A part's payout to the cent; dust under a cent is named rather than shown as 0.00. */
const payoutText = (value: bigint) => (value > 0n && value < CENT ? "less than 0.01 sDAI" : shownSdai(value));

const partName = (market: Address, parentMarket: Address, options: RedeemOption[], isInvalid: boolean) =>
  isAddressEqual(market, parentMarket)
    ? isInvalid
      ? "Refund (session invalid)"
      : "Winning outcome tokens"
    : (options.find((option) => isAddressEqual(option.market, market))?.name ?? market);

/** Where a ticked box sent the trade wallet's payout: the owner's address, broken only within itself. */
function Destination({ to, own }: { to?: Address; own: string }) {
  return to ? <span className="break-all">{to}</span> : <>{own}</>;
}

/** The after-redeem view: what each wallet redeemed and where it went. */
function Redeemed({ receipt }: { receipt: Receipt }) {
  return (
    <section className="rounded-fs-panel bg-fs-popup-panel flex flex-col gap-1 px-4 py-3">
      {receipt.trade ? (
        <p className="text-fs-popup-text text-sm text-pretty tabular-nums">
          {payoutText(receipt.trade.payout)} from your trade wallet, to{" "}
          <Destination to={receipt.trade.to} own="your trade wallet" />.
        </p>
      ) : null}
      {receipt.wallet ? (
        <p className="text-fs-popup-text text-sm text-pretty tabular-nums">
          {receipt.wallet.payout !== undefined
            ? `${payoutText(receipt.wallet.payout)} from your wallet, to your wallet.`
            : "Your wallet's unfinished redeem went through, to your wallet."}
        </p>
      ) : null}
    </section>
  );
}

/** The trade wallet's leg landed while the connected wallet's run is still to go or stopped. */
function TradeRedeemed({ leg }: { leg: NonNullable<Receipt["trade"]> }) {
  return (
    <p className="text-fs-popup-text-2 px-1 text-xs leading-4 text-pretty tabular-nums">
      Redeemed {payoutText(leg.payout)} from your trade wallet, to <Destination to={leg.to} own="your trade wallet" />.
    </p>
  );
}

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
      {/* one grid for every row, so payouts and P&Ls end on one right-aligned column */}
      <ul aria-labelledby={id} className="grid grid-cols-[minmax(0,1fr)_auto] divide-y divide-(--fs-popup-line)">
        {parts.map((part) => {
          const figure = pnlOf(part.market);
          return (
            <li
              key={part.market}
              className="col-span-2 grid grid-cols-subgrid items-baseline gap-x-4 gap-y-0.5 py-2.5 text-sm"
            >
              <span className="text-fs-popup-text row-span-2 min-w-0 font-semibold wrap-anywhere">
                {nameOf(part.market)}
              </span>
              <span className="text-fs-popup-text col-start-2 text-right whitespace-nowrap tabular-nums">
                {payoutText(part.payout)}
              </span>
              {figure !== undefined ? (
                <span data-column="pnl" className="col-start-2 text-right">
                  <PnlFigure value={figure} />
                </span>
              ) : null}
            </li>
          );
        })}
        {waiting.map((index) => (
          <li
            key={`waiting-${index}`}
            className="col-span-2 grid grid-cols-subgrid items-baseline gap-x-4 py-2.5 text-sm"
          >
            <span className="text-fs-popup-text min-w-0 font-semibold wrap-anywhere">
              {options.find((option) => option.outcomeIndex === index)?.name ?? `Option ${index + 1}`}
            </span>
            <span className="text-fs-popup-text-2 col-start-2 text-right">Waiting for result</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The pay-to-owner box (spec D12): off on every open; ticked, it names the trade wallet's on-chain `owner()`. */
function PayOwner({
  lineId,
  isTicked,
  isLocked,
  onChange,
  owner,
  isUnread,
  payout,
}: {
  /** The destination line's id, which the box and a held Redeem are described by. */
  lineId: string;
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
          aria-describedby={lineId}
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
      <p id={lineId} aria-live="polite" className="text-fs-popup-text-2 text-xs leading-4 text-pretty tabular-nums">
        {!isTicked ? (
          `${payoutText(payout)} goes to your trade wallet.`
        ) : owner ? (
          <>
            {payoutText(payout)} goes to <span className="break-all">{owner}</span>.
          </>
        ) : isUnread ? (
          "Could not read the trade wallet's owner. Untick to redeem into the trade wallet."
        ) : (
          "Reading the trade wallet's owner…"
        )}
      </p>
    </div>
  );
}

function ReadFailed({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="flex w-full flex-wrap items-center gap-3">
      <p className="type-label text-fs-text-secondary">{text}</p>
      <Button small variant="secondary" text="Read again" onPress={onRetry} />
    </div>
  );
}

function ReadFailedInDialog({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 px-1">
      <p className="text-fs-popup-text-2 text-xs leading-4 text-pretty">{text}</p>
      <button
        type="button"
        onClick={onRetry}
        className={clsx(
          "text-fs-popup-accent-text relative cursor-pointer text-[13px] leading-[18px] font-medium",
          "underline decoration-current/40 underline-offset-3",
          // a 44px tall target over the line it draws
          "before:absolute before:-inset-x-1 before:-inset-y-3 before:content-['']",
        )}
      >
        Read again
      </button>
    </div>
  );
}

/** Start over for a stopped run: forgets it, or, while it holds a send, asks first and then discards it. */
function useStartOver(run: WalletRedeemRunHandle) {
  const [asked, setAsked] = useState(false);
  const holdsSend = run.progress?.holdsSend === true;
  // a press answers the stop it was made on, so a later hold asks again
  useEffect(() => {
    if (!holdsSend) setAsked(false);
  }, [holdsSend]);
  return {
    isAsking: asked && holdsSend,
    press: () => (holdsSend ? setAsked(true) : run.reset()),
    confirm: () => {
      setAsked(false);
      run.discard();
    },
    cancel: () => setAsked(false),
  };
}

const QUIET_SLOT = "fs-enter w-28 shrink-0 [@media(max-width:374px)]:w-full";

/**
 * The popup's sticky footer, as the predict and liquidity popups have it: the busy button while a leg signs or
 * confirms, the action that carries a stopped run on, with Start over as the quiet one beside it.
 */
function RedeemFooter({
  run,
  trade,
  succeeded,
  onDone,
  onResume,
  idle,
}: {
  run: WalletRedeemRunHandle;
  trade: { isPending: boolean; stage?: TradeRedeemStage };
  succeeded: boolean;
  onDone: () => void;
  onResume: () => void;
  idle: { text: string; isDisabled: boolean; onPress: () => void; describedBy?: string };
}) {
  const progress = run.progress;
  const stage = progress?.stage;
  const startingOver = useStartOver(run);
  const frame = (children: ReactNode) => (
    // under 375px Start over and the wide button outgrow one row, so they stack in their focus order
    <div
      className={clsx(
        "predict-footer bg-fs-surface landscape-phone:pb-2 sticky bottom-0 flex gap-2 pt-2 pb-4 short:pb-3",
        "[@media(max-width:374px)]:flex-col",
      )}
    >
      {children}
    </div>
  );

  if (succeeded) return frame(<PopupButton text="Done" isDisabled={false} onPress={onDone} />);
  if (startingOver.isAsking) {
    return (
      <div className="predict-footer bg-fs-surface landscape-phone:pb-2 sticky bottom-0 flex flex-col gap-2 pt-2 pb-4 short:pb-3">
        <p role="alert" className="text-fs-popup-text-2 px-1 text-xs leading-4 text-pretty">
          {START_OVER_WARNING}
        </p>
        {/* Back takes the wide slot the press was made in, so a double press does not confirm */}
        <div className="flex gap-2 [@media(max-width:374px)]:flex-col">
          <div className={QUIET_SLOT}>
            <PopupButton text="Start over" quiet isDisabled={false} onPress={startingOver.confirm} />
          </div>
          <PopupButton text="Back" isDisabled={false} onPress={startingOver.cancel} />
        </div>
      </div>
    );
  }
  if (trade.isPending) {
    return frame(
      <PopupButton text="Redeem" busyText={TRADE_BUSY[trade.stage ?? "checking"]} isDisabled onPress={idle.onPress} />,
    );
  }
  if (run.isRunning) {
    const busy = stage === "confirming" ? "Confirming…" : "Confirm in your wallet";
    return frame(<PopupButton text="Redeem" busyText={busy} isDisabled onPress={idle.onPress} />);
  }
  const startOver = (
    <div className={QUIET_SLOT}>
      <PopupButton text="Start over" quiet isDisabled={false} onPress={startingOver.press} />
    </div>
  );
  if (stage === "review") {
    return frame(
      <>
        {startOver}
        <PopupButton text="Resume" isDisabled={false} onPress={onResume} />
      </>,
    );
  }
  if (stage === "halted") {
    return frame(
      progress?.failure?.retryable ? (
        <>
          {startOver}
          <PopupButton text="Try again" isDisabled={false} onPress={run.retry} />
        </>
      ) : (
        <PopupButton text="Start over" isDisabled={false} onPress={startingOver.press} />
      ),
    );
  }
  return frame(
    <PopupButton
      text={idle.text}
      isDisabled={idle.isDisabled}
      onPress={idle.onPress}
      aria-describedby={idle.describedBy}
    />,
  );
}

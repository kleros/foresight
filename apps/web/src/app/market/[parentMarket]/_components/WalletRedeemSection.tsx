"use client";

import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@kleros/ui-components-library";
import { isAddressEqual, type Address } from "viem";

import type { ParentResolution } from "@/features/resolution/api/getSessionResolution";
import type { SessionKey } from "@/features/resolution/api/useSessionResolution";
import type { RedeemFailureReason, RedeemProgress } from "@/features/resolution/redeem/run";

import { formatDisplayAmount } from "@/utils/amount";

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
 * What the connected wallet itself can redeem in a resolved session, the held options still waiting for their
 * result, and one Redeem that pays the sDAI to the wallet. Hidden while there is nothing to show.
 */
export function WalletRedeemSection({
  session,
  parent,
  parentMarket,
  options,
}: {
  session: SessionKey | undefined;
  parent: ParentResolution | Error | undefined;
  parentMarket: Address;
  options: RedeemOption[];
}) {
  const list = useWalletRedeem(session, parent);
  const run = useWalletRedeemRun(session);
  const stage = run.progress?.stage;
  const held = stage !== undefined && stage !== "idle" && stage !== "complete";

  if (!session || !list.owner || parent instanceof Error || !parent?.resolved) return null;

  if (list.isError && !held) {
    return (
      <Section>
        <p className="type-label text-fs-text-secondary">Could not read what your wallet can redeem.</p>
        <div>
          <Button small variant="secondary" text="Read again" onPress={() => void list.refetch()} />
        </div>
      </Section>
    );
  }
  const plan = list.data?.plan;
  if (!held && (!plan || (plan.parts.length === 0 && plan.waiting.length === 0))) return null;

  const nameOf = (market: Address) =>
    isAddressEqual(market, parentMarket)
      ? "Winning outcome tokens"
      : (options.find((option) => isAddressEqual(option.market, market))?.name ?? market);

  return (
    <Section>
      {plan ? (
        <ul className="flex flex-col gap-1" aria-label="What your wallet can redeem">
          {plan.parts.map((part) => (
            <li key={part.market} className="flex flex-wrap justify-between gap-x-4 text-sm">
              <span className="text-fs-text-primary min-w-0 break-words">{nameOf(part.market)}</span>
              <span className="text-fs-text-primary min-w-0 break-all tabular-nums">{sDai(part.payout)}</span>
            </li>
          ))}
          {plan.waiting.map((index) => (
            <li key={`waiting-${index}`} className="flex flex-wrap justify-between gap-x-4 text-sm">
              <span className="text-fs-text-primary min-w-0 break-words">
                {options.find((option) => option.outcomeIndex === index)?.name ?? `Option ${index + 1}`}
              </span>
              <span className="text-fs-text-secondary">Waiting for result</span>
            </li>
          ))}
        </ul>
      ) : null}
      {held ? (
        <RunStatus run={run} />
      ) : plan && plan.calls.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="type-label text-fs-text-secondary min-w-0 break-all tabular-nums">
            {sDai(plan.payout)} goes to your wallet.
          </p>
          <Button
            small
            text="Redeem"
            isDisabled={list.isFetching || !list.data}
            onPress={() => list.data && run.start(list.data.input)}
          />
        </div>
      ) : null}
    </Section>
  );
}

/** What the run is doing or why it stopped, with the actions that carry it on or let it go. */
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
      <div className="flex flex-col gap-2">
        <p role="alert" className="type-label text-fs-text-secondary text-pretty">
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
    <div className="flex flex-wrap items-center gap-3">
      <p role="status" aria-live="polite" className="type-label text-fs-text-secondary min-w-48 flex-1 text-pretty">
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

function Section({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="wallet-redeem-heading" className="fs-card flex flex-col gap-3 px-6 py-5">
      <h2 id="wallet-redeem-heading" className="text-fs-text-primary text-base font-semibold">
        Redeem from your wallet
      </h2>
      {children}
    </section>
  );
}

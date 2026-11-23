"use client";

import type { ReactNode } from "react";

import { Button } from "@kleros/ui-components-library";
import { isAddressEqual, type Address } from "viem";

import type { ParentResolution } from "@/features/resolution/api/getSessionResolution";
import type { SessionKey } from "@/features/resolution/api/useSessionResolution";
import type { RedeemFailureReason, RedeemProgress } from "@/features/resolution/redeem/run";

import { formatDisplayAmount } from "@/utils/amount";

import { useWalletRedeem, useWalletRedeemRun } from "./useWalletRedeem";

const SDAI_DECIMALS = 18;

/** Every decimal, so the shown payout is what the wallet receives to the wei. */
const sDai = (value: bigint) => `${formatDisplayAmount(value, SDAI_DECIMALS, SDAI_DECIMALS)} sDAI`;

interface RedeemOption {
  market: Address;
  outcomeIndex: number;
  name: string;
}

const FAILURE_COPY: Partial<Record<RedeemFailureReason, string>> = {
  rejected: "You rejected the request in your wallet.",
  changed: "What your wallet holds changed since you pressed Redeem. Nothing more was sent.",
  unlisted: "Not sent: this redeem does not match what Foresight allows for your account.",
  pending: "Your wallet has a transaction that has not landed yet. Try again once it has.",
  held: "A request from an earlier visit may still be open in your wallet. Reject it there, or approve it and try again.",
  "wrong-wallet": "Connect the account that started this redeem.",
  "wrong-chain": "Switch your wallet to Gnosis.",
  reverted: "A redeem transaction reverted.",
};

function progressCopy(progress: RedeemProgress | null) {
  switch (progress?.stage) {
    case "signing":
      return "Confirm the redeem in your wallet.";
    case "confirming":
      return "Redeeming.";
    case "review":
      return "A redeem you started earlier did not finish.";
    case "halted":
      return (progress.failure && FAILURE_COPY[progress.failure.reason]) ?? "The redeem stopped.";
    default:
      return undefined;
  }
}

/**
 * What the connected wallet itself can redeem in a resolved session, the held options still waiting for their result,
 * and one Redeem that sends the calls from the wallet, which receives the sDAI. Hidden while there is nothing to show.
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
  const read = useWalletRedeem(session, parent);
  const run = useWalletRedeemRun(read.owner, session);
  const stage = run.progress?.stage ?? "idle";
  const live = stage !== "idle" && stage !== "complete";
  const running = stage === "signing" || stage === "confirming";

  if (!session || !read.owner || parent instanceof Error || !parent?.resolved) return null;

  if (read.isError && !live) {
    return (
      <Section>
        <p className="type-label text-fs-text-secondary">Could not read what your wallet can redeem.</p>
        <div>
          <Button small variant="secondary" text="Read again" onPress={() => void read.refetch()} />
        </div>
      </Section>
    );
  }
  const data = read.data;
  const plan = data?.plan;
  if (!live && (!plan || (plan.parts.length === 0 && plan.waiting.length === 0))) return null;

  const nameOf = (market: Address) =>
    isAddressEqual(market, parentMarket)
      ? "Winning outcome tokens"
      : (options.find((option) => isAddressEqual(option.market, market))?.name ?? market);
  const status = progressCopy(run.progress);

  return (
    <Section>
      {plan && (plan.parts.length > 0 || plan.waiting.length > 0) ? (
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
      {status ? (
        <p className="type-label text-fs-text-secondary" role="status">
          {status}
        </p>
      ) : null}
      {stage === "review" ? (
        <div>
          <Button small text="Continue redeem" onPress={run.resume} />
        </div>
      ) : stage === "halted" ? (
        run.progress?.failure?.retryable ? (
          <div>
            <Button small text="Try again" onPress={run.retry} />
          </div>
        ) : null
      ) : data && plan && plan.calls.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="type-label text-fs-text-secondary min-w-0 break-all tabular-nums">
            {sDai(plan.payout)} goes to your wallet.
          </p>
          <Button small text="Redeem" isDisabled={running || read.isFetching} onPress={() => run.start(data.input)} />
        </div>
      ) : null}
    </Section>
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

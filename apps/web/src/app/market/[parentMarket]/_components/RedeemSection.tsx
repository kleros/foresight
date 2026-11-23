"use client";

import type { ReactNode } from "react";

import { Button } from "@kleros/ui-components-library";
import { isAddressEqual, type Address } from "viem";

import type { ParentResolution } from "@/features/resolution/api/getSessionResolution";
import type { SessionKey } from "@/features/resolution/api/useSessionResolution";

import { formatDisplayAmount } from "@/utils/amount";

import { useRedeemFromTradeWallet, useTradeWalletRedeem } from "./useTradeWalletRedeem";

const SDAI_DECIMALS = 18;

/** Every decimal, so the shown payout is what the trade wallet receives to the wei. */
const sDai = (value: bigint) => `${formatDisplayAmount(value, SDAI_DECIMALS, SDAI_DECIMALS)} sDAI`;

interface RedeemOption {
  market: Address;
  outcomeIndex: number;
  name: string;
}

/**
 * What the connected account's trade wallet can redeem in a resolved session, the held options still waiting for
 * their result, and one Redeem that pays the sDAI into the trade wallet. Hidden while there is nothing to show.
 */
export function RedeemSection({
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
  const plan = useTradeWalletRedeem(session, parent);
  const redeem = useRedeemFromTradeWallet();
  const owner = plan.owner;

  if (!session || !owner) return null;
  if (parent instanceof Error) {
    return (
      <Section>
        <p className="type-label text-fs-text-secondary">Could not read this session&apos;s result.</p>
      </Section>
    );
  }
  if (!parent?.resolved) return null;

  if (plan.isError) {
    return (
      <Section>
        <p className="type-label text-fs-text-secondary">Could not read what your trade wallet can redeem.</p>
        <div>
          <Button small variant="secondary" text="Read again" onPress={() => void plan.refetch()} />
        </div>
      </Section>
    );
  }
  const data = plan.data;
  if (!data || (data.parts.length === 0 && data.waiting.length === 0)) return null;

  const nameOf = (market: Address) =>
    isAddressEqual(market, parentMarket)
      ? "Winning outcome tokens"
      : (options.find((option) => isAddressEqual(option.market, market))?.name ?? market);

  return (
    <Section>
      <ul className="flex flex-col gap-1" aria-label="What your trade wallet can redeem">
        {data.parts.map((part) => (
          <li key={part.market} className="flex flex-wrap justify-between gap-x-4 text-sm">
            <span className="text-fs-text-primary min-w-0 break-words">{nameOf(part.market)}</span>
            <span className="text-fs-text-primary min-w-0 break-all tabular-nums">{sDai(part.payout)}</span>
          </li>
        ))}
        {data.waiting.map((index) => (
          <li key={`waiting-${index}`} className="flex flex-wrap justify-between gap-x-4 text-sm">
            <span className="text-fs-text-primary min-w-0 break-words">
              {options.find((option) => option.outcomeIndex === index)?.name ?? `Option ${index + 1}`}
            </span>
            <span className="text-fs-text-secondary">Waiting for result</span>
          </li>
        ))}
      </ul>
      {data.tx ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="type-label text-fs-text-secondary min-w-0 break-all tabular-nums">
            {sDai(data.payout)} goes to your trade wallet.
          </p>
          <Button
            small
            text="Redeem"
            isDisabled={redeem.isPending || plan.isFetching}
            onPress={() => redeem.mutate({ shown: data, owner, session })}
          />
        </div>
      ) : null}
    </Section>
  );
}

function Section({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="redeem-heading" className="fs-card flex flex-col gap-3 px-6 py-5">
      <h2 id="redeem-heading" className="text-fs-text-primary text-base font-semibold">
        Redeem from your trade wallet
      </h2>
      {children}
    </section>
  );
}

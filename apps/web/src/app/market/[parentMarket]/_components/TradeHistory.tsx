"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@kleros/ui-components-library";
import clsx from "clsx";
import { useAccount } from "wagmi";

import { useSessionTrades } from "@/features/sessions/api/getSessionTrades";
import { approxCollateral } from "@/features/sessions/components/SessionMetricDialog";
import type { PredictionTrade, SessionDetail, SessionTrade } from "@/features/sessions/types";
import { collateralVolume } from "@/features/sessions/utils/collateralVolume";

import { SectionCard } from "@/components/ui/SectionCard";

import ExternalArrow from "@/assets/svg/external-arrow.svg";

import { shortenAddress } from "@/utils/address";
import { formatLocalInstant, timeAgo } from "@/utils/date";
import { shortHash } from "@/utils/hash";

import { DEFAULT_CHAIN } from "@/config/chains";
import { explorerTxUrl } from "@/config/site";

import { TradeDetailDialog } from "./TradeDetailDialog";

const ROW =
  "grid min-w-0 flex-1 grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-left md:grid-cols-[6rem_9rem_minmax(0,1fr)_8rem]";

function TxLink({ hash }: { hash: string }) {
  const href = explorerTxUrl(hash, DEFAULT_CHAIN);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Transaction ${shortHash(hash)}`}
      title={hash}
      className="text-fs-text-secondary hover:text-fs-text-accent rounded-fs-control inline-flex size-8 shrink-0 items-center justify-center"
    >
      <ExternalArrow className="size-4 [&_path]:fill-current" aria-hidden />
    </a>
  );
}

function When({ timestamp }: { timestamp: number }) {
  const instant = new Date(timestamp * 1000);
  return (
    <span className="text-fs-text-secondary" title={formatLocalInstant(instant)}>
      {timeAgo(instant)}
    </span>
  );
}

/** Every trade in the session, foresight's predictions and swaps made straight through the pools, newest first. */
export function TradeHistory({ session }: { session: SessionDetail }) {
  const trades = useSessionTrades(session.id);
  const { address } = useAccount();
  const [open, setOpen] = useState<PredictionTrade | null>(null);

  const nameOf = (market: string) =>
    session.options.find((option) => option.market.toLowerCase() === market)?.name ?? shortenAddress(market);
  const size = (underlying: bigint) =>
    approxCollateral(collateralVolume(session, underlying < 0n ? -underlying : underlying), session.collateralSymbol);
  const traderOf = (trade: PredictionTrade) =>
    address && trade.owner === address.toLowerCase() ? "You" : shortenAddress(trade.owner);

  const row = (trade: SessionTrade): ReactNode => {
    if (trade.kind === "external") {
      return (
        <div className={ROW}>
          <When timestamp={trade.timestamp} />
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{trade.sender ? shortenAddress(trade.sender) : "-"}</span>
            <span className="text-fs-text-secondary border-fs-border rounded-full border px-1.5 text-xs">External</span>
          </span>
          <span className="min-w-0 truncate max-md:col-start-2">
            {nameOf(trade.childMarket)} · {trade.side} {trade.bought ? "buy" : "sell"}
          </span>
          <span className="tabular-nums max-md:col-start-2 md:text-right">{size(trade.underlying)}</span>
        </div>
      );
    }
    const [first, ...rest] = trade.options.map((option) => nameOf(option.childMarket));
    return (
      <button
        type="button"
        onClick={() => setOpen(trade)}
        className={clsx(ROW, "hover:bg-fs-surface-tint -mx-2 cursor-pointer rounded-fs-control px-2 py-1")}
      >
        <When timestamp={trade.timestamp} />
        <span className="truncate">{traderOf(trade)}</span>
        <span className="flex min-w-0 gap-1 max-md:col-start-2" title={[first, ...rest].join(", ")}>
          <span className="truncate">{first}</span>
          {rest.length > 0 ? <span className="text-fs-text-secondary shrink-0">+{rest.length}</span> : null}
        </span>
        <span className="tabular-nums max-md:col-start-2 md:text-right">{size(trade.underlyingDelta)}</span>
      </button>
    );
  };

  return (
    <SectionCard className="flex flex-col gap-3 p-4 md:px-8">
      <h3 className="text-fs-text-primary text-base font-semibold">All trades</h3>
      {trades.isPending ? (
        <div className="flex flex-col gap-2" aria-busy>
          <div className="fs-skeleton h-8" />
          <div className="fs-skeleton h-8" />
          <div className="fs-skeleton h-8" />
        </div>
      ) : trades.isError ? (
        <p className="text-fs-text-secondary text-sm">Could not load the trades. Reload in a moment.</p>
      ) : trades.data.length === 0 ? (
        <p className="text-fs-text-secondary text-sm">No trades yet.</p>
      ) : (
        <ul className="text-fs-text-primary divide-y divide-fs-border text-sm">
          {trades.data.map((trade) => (
            <li key={trade.id} className="flex items-center gap-2 py-1.5">
              {row(trade)}
              <TxLink hash={trade.transactionHash} />
            </li>
          ))}
        </ul>
      )}
      {trades.hasNextPage ? (
        <Button
          small
          variant="secondary"
          text="Load more"
          isLoading={trades.isFetchingNextPage}
          isDisabled={trades.isFetchingNextPage}
          onPress={() => void trades.fetchNextPage()}
          className="self-center"
        />
      ) : null}
      <TradeDetailDialog
        trade={open}
        trader={open ? traderOf(open) : ""}
        options={session.options}
        txUrl={open ? explorerTxUrl(open.transactionHash, DEFAULT_CHAIN) : undefined}
        onClose={() => setOpen(null)}
      />
    </SectionCard>
  );
}

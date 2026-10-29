"use client";

import clsx from "clsx";

import type { PredictionTrade, SessionOption, TradeOption } from "@/features/sessions/types";
import { estimateAt, setsMinted, sideSwaps } from "@/features/sessions/utils/tradeDetail";

import { ExternalLink } from "@/components/ui/ExternalLink";
import { Modal } from "@/components/ui/Modal";
import { PopupCloseButton } from "@/components/ui/Popup";

import { formatDisplayAmount } from "@/utils/amount";
import { formatLocalInstant } from "@/utils/date";
import { formatEstimate } from "@/utils/formatEstimate";

/** Outcome and underlying tokens are wrapped ERC-1155 positions, 18 decimals each. */
const TOKEN_DECIMALS = 18;
const tokens = (value: bigint) => formatDisplayAmount(value, TOKEN_DECIMALS, 4);

// the {" "} runs keep a line's words apart in its text (copied or read out); flex layout drops them
function Line({ label, children }: { label: string; children: string }) {
  return (
    <li className="flex justify-between gap-3 py-2">
      {" "}
      <span className="text-fs-popup-text-2 shrink-0">{label}</span>{" "}
      <span className="text-fs-popup-text min-w-0 text-right wrap-anywhere">{children}</span>{" "}
    </li>
  );
}

function OptionBlock({ option, scale }: { option: TradeOption; scale: SessionOption | undefined }) {
  const before = scale ? estimateAt(option, scale, "before") : null;
  const after = scale ? estimateAt(option, scale, "after") : null;
  const minted = setsMinted(option);
  const estimate = (value: number | null) => (value === null ? "-" : formatEstimate(value, scale?.unit ?? null));

  return (
    <section className="rounded-fs-panel bg-fs-popup-panel px-4 py-1">
      <div className="flex justify-between gap-3 py-2.5 text-sm font-semibold">
        <span className="text-fs-popup-text min-w-0 wrap-anywhere">{scale?.name ?? option.childMarket}</span>{" "}
        <span className="text-fs-popup-text shrink-0 tabular-nums">
          {estimate(before)} → {estimate(after)}
        </span>{" "}
      </div>
      <ul className="divide-y divide-(--fs-popup-line) border-t border-(--fs-popup-line) text-[13px] leading-[18px] tabular-nums">
        {minted !== 0n ? (
          <Line label={minted > 0n ? "Mint" : "Merge"}>{`${tokens(minted > 0n ? minted : -minted)} DOWN + UP`}</Line>
        ) : null}
        {sideSwaps(option).map((swap) => (
          <Line key={swap.side} label={`${swap.bought ? "Buy" : "Sell"} ${swap.side}`}>
            {`${tokens(swap.tokens)} at ${swap.avgPrice === null ? "-" : tokens(swap.avgPrice)} · ${tokens(swap.underlying)} underlying`}
          </Line>
        ))}
        <Line label="Balance after">{`${tokens(option.downBalance)} DOWN · ${tokens(option.upBalance)} UP`}</Line>
      </ul>
    </section>
  );
}

/** One prediction broken down per option: the estimate it moved, each mint, merge and swap, and the balances left. */
export function TradeDetailDialog({
  trade,
  trader,
  options,
  txUrl,
  onClose,
}: {
  trade: PredictionTrade | null;
  /** "You", or the trader's short address. */
  trader: string;
  options: SessionOption[];
  txUrl: string | undefined;
  onClose: () => void;
}) {
  const scaleOf = (market: string) => options.find((option) => option.market.toLowerCase() === market);

  return (
    <Modal
      ariaLabel="Prediction"
      isOpen={trade !== null}
      isDismissable
      onOpenChange={(open) => (open ? undefined : onClose())}
      className={clsx(
        "h-fit max-h-[calc(100dvh-32px)] w-[calc(100vw-2rem)] max-w-[480px] overflow-y-auto",
        "flex flex-col gap-4 p-5 sm:p-6",
        "fs-aurora rounded-fs-popup bg-fs-surface border border-(--fs-popup-edge) shadow-(--fs-popup-shadow)",
      )}
    >
      {trade ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-fs-popup-text text-lg font-semibold tracking-[-0.01em]">Prediction</h2>
              <p className="text-fs-popup-text-2 text-[13px] leading-[18px]">
                {trader} · {formatLocalInstant(new Date(trade.timestamp * 1000))}
              </p>
              {txUrl ? <ExternalLink href={txUrl}>View transaction</ExternalLink> : null}
            </div>
            <PopupCloseButton isDisabled={false} onPress={onClose} />
          </div>
          <div className="flex flex-col gap-2">
            {trade.options.map((option) => (
              <OptionBlock key={option.childMarket} option={option} scale={scaleOf(option.childMarket)} />
            ))}
          </div>
        </>
      ) : null}
    </Modal>
  );
}

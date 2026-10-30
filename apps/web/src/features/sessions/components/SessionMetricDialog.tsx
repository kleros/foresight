"use client";

import { useEffect, useRef } from "react";

import clsx from "clsx";

import { POPUP_FRAME, PopupCloseButton } from "@/components/ui/Popup";
import { ScrollFade } from "@/components/ui/ScrollFade";

import { formatDisplayAmount } from "@/utils/amount";
import { formatEstimate } from "@/utils/formatEstimate";

import type { PoolMetrics, SessionMetrics } from "../utils/sessionMetrics";

export type MetricKind = "volume" | "notional" | "liquidity";

export const METRIC_TITLES: Record<MetricKind, string> = {
  volume: "Volume",
  notional: "Notional volume",
  liquidity: "Liquidity",
};

const HINTS: Record<MetricKind, string> = {
  volume: "The underlying side of every swap through the session's pools, foresight's or anyone's.",
  notional: "The outcome-token side of every swap, each token counted at the most it redeems for.",
  liquidity: "What each pool holds: its outcome tokens at the pool's price, plus its underlying.",
};

/** A collateral figure, approximate because one underlying counts as an even share of the collateral. */
export const approxCollateral = (value: number | null, symbol: string | null) =>
  value === null ? "-" : `~${formatEstimate(value, symbol)}`;

// the {" "} runs keep a line's words apart in its text (copied or read out); flex layout drops them
function PoolLine({ kind, pool, symbol }: { kind: MetricKind; pool: PoolMetrics; symbol: string | null }) {
  const { liquidity } = pool;
  if (kind !== "liquidity") {
    return (
      <li className="flex justify-between gap-3 py-2">
        {" "}
        <span className="text-fs-popup-text-2">{pool.side}</span>{" "}
        <span className="text-fs-popup-text">{approxCollateral(pool[kind], symbol)}</span>{" "}
      </li>
    );
  }
  return (
    <li className="flex justify-between gap-3 py-2">
      {" "}
      <span className="text-fs-popup-text-2 min-w-0 wrap-anywhere">
        {liquidity
          ? `${formatDisplayAmount(liquidity.outcome, 18, 2)} ${pool.side} / ${formatDisplayAmount(liquidity.underlying, 18, 2)} underlying`
          : pool.side}
      </span>{" "}
      <span className="text-fs-popup-text shrink-0 text-right">
        {approxCollateral(liquidity?.value ?? null, symbol)}{" "}
        {liquidity && !liquidity.priced ? (
          <span className="text-fs-popup-text-2 block text-xs">not priced yet</span>
        ) : null}
      </span>{" "}
    </li>
  );
}

/**
 * One stat broken down: the total on top, then a block per option with a line per UP and DOWN pool.
 * Non-modal, so the page stays in the accessibility tree; Escape, the close button or a press outside closes it.
 */
export function SessionMetricDialog({
  kind,
  onClose,
  metrics,
  symbol,
  usdPrice,
}: {
  kind: MetricKind;
  onClose: () => void;
  metrics: SessionMetrics;
  symbol: string | null;
  /** USD per unit of collateral; only an sDAI session has one. */
  usdPrice: number | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const total = metrics[kind];

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
  }, []);

  useEffect(() => {
    // mousedown, not click: the click that opened the popup is still bubbling when this runs
    const dismiss = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [onClose]);

  // a press outside leaves focus where it landed; the popup's own ways out hand it back to the stat
  const closeToOpener = () => {
    opener.current?.focus();
    onClose();
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={METRIC_TITLES[kind]}
      tabIndex={-1}
      onKeyDown={(event) => (event.key === "Escape" ? closeToOpener() : undefined)}
      className={clsx(POPUP_FRAME, "z-40 outline-none")}
    >
      <div className="landscape-phone:overflow-y-auto relative flex min-h-0 w-full flex-col">
        <div className="bg-fs-surface landscape-phone:sticky landscape-phone:top-0 landscape-phone:z-20 mb-2 flex h-8 shrink-0 items-center justify-between">
          <h2 className="text-fs-popup-text text-lg font-semibold tracking-[-0.01em]">{METRIC_TITLES[kind]}</h2>
          <PopupCloseButton isDisabled={false} onPress={closeToOpener} />
        </div>

        <div className="flex flex-col gap-0.5 pb-3">
          <p className="text-fs-popup-text text-2xl font-semibold tabular-nums">{approxCollateral(total, symbol)}</p>
          {usdPrice !== undefined && total !== null ? (
            <p className="text-fs-popup-text-2 text-sm tabular-nums">≈ ${formatEstimate(total * usdPrice, null)}</p>
          ) : null}
          <p className="text-fs-popup-text-2 text-xs leading-4 text-pretty">{HINTS[kind]}</p>
        </div>

        <ScrollFade
          className="landscape-phone:min-h-0 landscape-phone:flex-none w-full"
          cue="More below"
          cueTone="border-(--fs-popup-line) text-fs-popup-text-2"
          minOverflow={1}
          fadeSize={40}
        >
          <div className="flex flex-col gap-2 pb-4">
            {metrics.options.map((option) => (
              <section key={option.market} className="rounded-fs-panel bg-fs-popup-panel px-4 py-1">
                <div className="flex justify-between gap-3 py-2.5 text-sm font-semibold">
                  <span className="text-fs-popup-text min-w-0 wrap-anywhere">{option.name}</span>{" "}
                  <span className="text-fs-popup-text shrink-0 tabular-nums">
                    {approxCollateral(option[kind], symbol)}
                  </span>{" "}
                </div>
                {option.pools.length > 0 ? (
                  <ul className="divide-y divide-(--fs-popup-line) border-t border-(--fs-popup-line) text-[13px] leading-[18px] tabular-nums">
                    {option.pools.map((pool) => (
                      <PoolLine key={pool.side} kind={kind} pool={pool} symbol={symbol} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-fs-popup-text-2 border-t border-(--fs-popup-line) py-2 text-[13px]">
                    No pool yet.
                  </p>
                )}
              </section>
            ))}
          </div>
        </ScrollFade>
      </div>
    </div>
  );
}

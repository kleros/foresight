"use client";

import { useCallback, useRef, useState, type ReactNode, type RefObject } from "react";

import { AlertMessage } from "@kleros/ui-components-library";
import clsx from "clsx";

import { PnlFlow } from "@/features/resolution/components/PnlFigure";
import type { RealisedPnl } from "@/features/resolution/utils/realisedPnl";
import type { OptionResult, SessionResults } from "@/features/resolution/utils/sessionResults";
import { DisplayBlocks } from "@/features/sessions/components/DisplayBlocks";
import {
  approxCollateral,
  METRIC_TITLES,
  SessionMetricDialog,
  type MetricKind,
} from "@/features/sessions/components/SessionMetricDialog";
import { SessionStat } from "@/features/sessions/components/SessionStat";
import type {
  PoolBalances,
  SessionDetail,
  SessionOption,
  SessionStats,
  SessionStatus,
} from "@/features/sessions/types";
import { bannerStyle } from "@/features/sessions/utils/bannerStyle";
import { optionNoun } from "@/features/sessions/utils/optionNoun";
import { sessionMetrics } from "@/features/sessions/utils/sessionMetrics";
import { statusChip } from "@/features/sessions/utils/statusChip";
import { resolutionOpened } from "@/features/sessions/utils/toSessionDetail";

import { ExternalLink } from "@/components/ui/ExternalLink";
import { ForesightIcon } from "@/components/ui/ForesightIcon";
import { StatusChip } from "@/components/ui/StatusChip";

import ChartIcon from "@/assets/svg/chart-bar.svg";
import CountdownIcon from "@/assets/svg/cronometer.svg";
import TradersIcon from "@/assets/svg/eye-outline.svg";
import VolumeIcon from "@/assets/svg/tag-category.svg";

import { shortenAddress } from "@/utils/address";
import { formatUtcInstant, timeLeftUntil } from "@/utils/date";

import { DEFAULT_CHAIN } from "@/config/chains";
import { explorerAddressUrl } from "@/config/site";

export function SessionHeader({
  session,
  status,
  stats,
  statsPending,
  poolBalances,
  poolBalancesPending,
  usdPrice,
  results,
  pnl,
  redeem,
}: {
  session: SessionDetail;
  status: SessionStatus;
  stats: SessionStats | undefined;
  statsPending: boolean;
  poolBalances: PoolBalances | undefined;
  poolBalancesPending: boolean;
  /** USD per unit of collateral; only an sDAI session has one. */
  usdPrice: number | undefined;
  /** The session's results once its parent resolved. */
  results?: SessionResults<SessionOption>;
  /** The visitor's realised P&L in the session; undefined where there is none to show. */
  pnl?: RealisedPnl["session"];
  /** The Redeem control, beside the P&L (spec D18); it may render nothing. */
  redeem?: ReactNode;
}) {
  // a gateway that cannot serve an image leaves the gradient and no icon, not a broken image
  const [heroFailed, setHeroFailed] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);
  const [openMetric, setOpenMetric] = useState<MetricKind | null>(null);
  const statButtons: Record<MetricKind, RefObject<HTMLButtonElement>> = {
    volume: useRef<HTMLButtonElement>(null),
    notional: useRef<HTMLButtonElement>(null),
    liquidity: useRef<HTMLButtonElement>(null),
  };
  const closeMetric = useCallback(() => setOpenMetric(null), []);
  const metrics = stats ? sessionMetrics(session, stats, poolBalances) : null;
  const toggleMetric = (kind: MetricKind) => setOpenMetric((open) => (open === kind ? null : kind));
  const metricStat = (kind: MetricKind, Icon: typeof VolumeIcon, pending: boolean) => (
    <SessionStat
      Icon={Icon}
      label={METRIC_TITLES[kind]}
      pending={pending}
      onOpen={metrics?.[kind] != null ? () => toggleMetric(kind) : undefined}
      buttonRef={statButtons[kind]}
      expanded={openMetric === kind}
    >
      {approxCollateral(metrics?.[kind] ?? null, session.collateralSymbol)}
    </SessionStat>
  );
  const explorer = explorerAddressUrl(session.parentMarket, DEFAULT_CHAIN);

  return (
    <header className="flex flex-col gap-4">
      <h1 className="type-h1 text-fs-text-primary text-balance">{session.name}</h1>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {session.closesAt ? (
          <SessionStat Icon={ChartIcon} label="Resolution opens">
            {formatUtcInstant(session.closesAt)}
          </SessionStat>
        ) : null}
        {session.closesAt && !resolutionOpened(session.closesAt, new Date()) ? (
          <SessionStat Icon={CountdownIcon} label="Countdown">
            {timeLeftUntil(session.closesAt.toISOString())}
          </SessionStat>
        ) : null}
        <SessionStat Icon={TradersIcon} label="Traders" pending={statsPending}>
          {stats ? String(stats.traders) : "-"}
        </SessionStat>
        {metricStat("volume", VolumeIcon, statsPending)}
        {metricStat("notional", VolumeIcon, statsPending)}
        {metricStat("liquidity", ChartIcon, statsPending || (stats !== undefined && poolBalancesPending))}
      </div>
      {openMetric && metrics ? (
        <SessionMetricDialog
          kind={openMetric}
          onClose={closeMetric}
          opener={statButtons[openMetric]}
          metrics={metrics}
          symbol={session.collateralSymbol}
          decimals={session.collateralDecimals ?? 18}
          usdPrice={usdPrice}
        />
      ) : null}

      <div className="border-gradient-purple-blue bg-fs-surface relative">
        <div
          className={clsx("border-fs-border mx-px mt-px h-45 border-b", "rounded-t-[11px] bg-cover bg-center")}
          style={bannerStyle(heroFailed ? null : session.heroUri)}
          role="presentation"
        />
        {session.heroUri && !heroFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- a hidden probe: a CSS background reports no load failure
          <img data-testid="hero-probe" src={session.heroUri} alt="" hidden onError={() => setHeroFailed(true)} />
        ) : null}
        {session.iconUri && !iconFailed ? (
          <span
            className={clsx(
              "rounded-fs border-fs-surface bg-fs-surface absolute top-40 left-5",
              "inline-flex h-11 w-11 items-center justify-center overflow-hidden border-2",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- the gateway is env-configured, so no static remotePattern can cover it */}
            <img
              data-testid="session-icon"
              className="h-full w-full object-cover"
              src={session.iconUri}
              alt=""
              onError={() => setIconFailed(true)}
            />
          </span>
        ) : null}
        <div className="flex flex-col gap-2.5 px-6 pt-8 pb-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusChip tone={statusChip[status].tone} label={statusChip[status].label} />
            {explorer ? <ExternalLink href={explorer}>{shortenAddress(session.parentMarket)}</ExternalLink> : null}
          </div>
          <h2 className="text-fs-text-primary text-lg font-semibold text-pretty">{session.question}</h2>
          {session.description ? (
            <p className="text-fs-text-secondary text-sm leading-relaxed">{session.description}</p>
          ) : null}
          {results ? <Answers results={results} /> : null}
          {/* hidden while empty, as it is when the Redeem control renders nothing and there is no P&L */}
          <div className="border-fs-border flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 empty:hidden">
            {pnl ? (
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <PnlFlow cost={pnl.cost} payout={pnl.payout} />
                {pnl.waiting.length > 0 ? (
                  <span className="type-caption text-fs-text-secondary">
                    Excludes {optionNoun(session.itemNamePlural)} waiting for their result.
                  </span>
                ) : null}
              </div>
            ) : null}
            {redeem}
          </div>
          {session.blocks.length > 0 ? (
            <>
              <div className="border-fs-border border-t pt-3" />
              <DisplayBlocks blocks={session.blocks} />
            </>
          ) : null}
        </div>
      </div>

      {status === "setting-up" ? (
        <AlertMessage
          variant="warning"
          title="Setup unfinished"
          msg="This session is not open yet, the creator is still setting it up."
        />
      ) : null}

      {session.metadataResolved ? null : (
        <p className="type-caption text-fs-text-secondary flex items-center gap-2">
          <ForesightIcon name="info-circle" size={14} />
          The display details for this session could not be loaded, so market names are shown as they are on chain.
        </p>
      )}
    </header>
  );
}

/** A winner's answer under the question; null while its read is out. */
function answerOf(result: OptionResult | undefined): { text: string; className: string } | null {
  switch (result?.kind) {
    case "final":
      return { text: result.text, className: "text-fs-tone-success-text font-semibold" };
    case "waiting":
      return { text: "Waiting for result", className: "text-fs-text-secondary" };
    case "invalid":
      return { text: "Invalid", className: "text-fs-tone-warning-text" };
    case "unread":
      return { text: "Result unknown", className: "text-fs-tone-warning-text" };
    default:
      return null;
  }
}

/** The session's results read as the question's answer (spec D20): each winner and its value, or Invalid. */
function Answers({ results }: { results: SessionResults<SessionOption> }) {
  const items = results.winners.flatMap((option) => {
    const answer = answerOf(results.options[option.market.toLowerCase()]);
    return answer ? [{ option, answer }] : [];
  });
  if (results.invalidPayouts === null && items.length === 0) return null;
  return (
    <ul aria-label="Results" className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
      {results.invalidPayouts !== null ? (
        <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <StatusChip tone="attention" label="Invalid" />
          <span className="type-caption text-fs-text-secondary">{results.invalidPayouts}</span>
        </li>
      ) : null}
      {items.map(({ option, answer }) => (
        <li key={option.market} className="flex min-w-0 items-center gap-2">
          <span className="size-2 flex-none rounded-full" style={{ backgroundColor: option.color }} aria-hidden />
          <span className="text-fs-text-primary min-w-0 wrap-break-word">{option.name}</span>
          <span className={clsx("whitespace-nowrap tabular-nums", answer.className)}>{answer.text}</span>
        </li>
      ))}
    </ul>
  );
}

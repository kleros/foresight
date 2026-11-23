"use client";

import { useCallback, useRef, useState, type RefObject } from "react";

import { AlertMessage } from "@kleros/ui-components-library";
import clsx from "clsx";

import { DisplayBlocks } from "@/features/sessions/components/DisplayBlocks";
import {
  approxCollateral,
  METRIC_TITLES,
  SessionMetricDialog,
  type MetricKind,
} from "@/features/sessions/components/SessionMetricDialog";
import { SessionStat } from "@/features/sessions/components/SessionStat";
import type { PoolBalances, SessionDetail, SessionStats, SessionStatus } from "@/features/sessions/types";
import { bannerStyle } from "@/features/sessions/utils/bannerStyle";
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
}: {
  session: SessionDetail;
  status: SessionStatus;
  stats: SessionStats | undefined;
  statsPending: boolean;
  poolBalances: PoolBalances | undefined;
  poolBalancesPending: boolean;
  /** USD per unit of collateral; only an sDAI session has one. */
  usdPrice: number | undefined;
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

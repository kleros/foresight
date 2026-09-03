import { AlertMessage } from "@kleros/ui-components-library";
import clsx from "clsx";

import { DisplayBlocks } from "@/features/sessions/components/DisplayBlocks";
import { SessionStat } from "@/features/sessions/components/SessionStat";
import type { SessionDetail, SessionStats, SessionStatus } from "@/features/sessions/types";
import { bannerStyle } from "@/features/sessions/utils/bannerStyle";
import { collateralVolume } from "@/features/sessions/utils/collateralVolume";
import { statusChip } from "@/features/sessions/utils/statusChip";

import { ForesightIcon } from "@/components/ui/ForesightIcon";
import { StatusChip } from "@/components/ui/StatusChip";

import TradingIcon from "@/assets/svg/chart-bar.svg";
import CountdownIcon from "@/assets/svg/cronometer.svg";
import TradersIcon from "@/assets/svg/eye-outline.svg";
import VolumeIcon from "@/assets/svg/tag-category.svg";

import { formatUtcInstant, timeLeftUntil } from "@/utils/date";
import { formatEstimate } from "@/utils/formatEstimate";

export function SessionHeader({
  session,
  status,
  stats,
  statsPending,
}: {
  session: SessionDetail;
  status: SessionStatus;
  stats: SessionStats | undefined;
  statsPending: boolean;
}) {
  const volume = stats ? collateralVolume(session, stats.volumeUnderlying) : null;

  return (
    <header className="flex flex-col gap-4">
      <h1 className="type-h1 text-fs-text-primary text-balance">{session.name}</h1>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {session.closesAt ? (
          <SessionStat Icon={TradingIcon} label="Trading until">
            {formatUtcInstant(session.closesAt)}
          </SessionStat>
        ) : null}
        {session.closesAt && status === "trading" ? (
          <SessionStat Icon={CountdownIcon} label="Countdown">
            {timeLeftUntil(session.closesAt.toISOString())}
          </SessionStat>
        ) : null}
        <SessionStat Icon={TradersIcon} label="Traders" pending={statsPending}>
          {stats ? String(stats.traders) : "-"}
        </SessionStat>
        <SessionStat Icon={VolumeIcon} label="Volume" pending={statsPending}>
          {volume !== null ? formatEstimate(volume, session.collateralSymbol) : "-"}
        </SessionStat>
      </div>

      <div className="border-gradient-purple-blue bg-fs-surface relative">
        <div
          className={clsx("border-fs-border mx-px mt-px h-45 border-b", "rounded-t-[11px] bg-cover bg-center")}
          style={bannerStyle(session.heroUri)}
          role="presentation"
        />
        {session.iconUri ? (
          <span
            className={clsx(
              "rounded-fs border-fs-surface bg-fs-surface absolute top-40 left-5",
              "inline-flex h-11 w-11 items-center justify-center overflow-hidden border-2",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- the gateway is env-configured, so no static remotePattern can cover it */}
            <img className="h-full w-full object-cover" src={session.iconUri} alt="" />
          </span>
        ) : null}
        <div className="flex flex-col gap-2.5 px-6 pt-8 pb-5">
          <div>
            <StatusChip tone={statusChip[status].tone} label={statusChip[status].label} />
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

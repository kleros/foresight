import Link from "next/link";

import ArrowIcon from "@/assets/svg/arrow-right.svg";
import TradingIcon from "@/assets/svg/chart-bar.svg";
import CountdownIcon from "@/assets/svg/cronometer.svg";
import TagIcon from "@/assets/svg/tag-category.svg";

import { shortenAddress } from "@/utils/address";
import { formatUtcInstant, timeLeftUntil } from "@/utils/date";

import { paths } from "@/config/paths";

import type { SessionSummary } from "../types";
import { SessionStat } from "./SessionStat";
import { bannerStyle } from "../utils/bannerStyle";
import { resolutionOpened } from "../utils/toSessionDetail";

export function SessionCard({ session }: { session: SessionSummary }) {
  const { closesAt } = session;

  return (
    <Link className="fs-session-card" href={paths.market.getHref(session.parentMarket)}>
      <div className="fs-session-card__inner border-gradient-purple-blue">
        <div className="fs-session-card__banner" style={bannerStyle(session.heroUri)} />

        <div className="fs-session-card__body">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pt-4.5">
            <div className="border-b-klerosUIComponentsSecondaryBlue flex shrink-0 flex-col items-start gap-2 border-b pb-4">
              <h3 className="text-fs-accent text-base font-semibold">{session.name}</h3>
              <p className="text-fs-text-primary line-clamp-2 min-h-[2lh] text-sm leading-relaxed">
                {session.description}
              </p>
            </div>

            <div className="mt-4 flex shrink-0 items-center gap-2">
              <TagIcon className="text-fs-accent size-4 shrink-0 [&_path]:fill-current" />
              <span className="text-fs-accent text-sm font-semibold">
                {session.branchCount} {session.branchNoun}
              </span>
            </div>

            {closesAt ? (
              <div className="fs-session-card__reveal mt-2 flex shrink-0 flex-col gap-2">
                <SessionStat Icon={TradingIcon} label="Resolution opens">
                  {formatUtcInstant(closesAt)}
                </SessionStat>
                {resolutionOpened(closesAt, new Date()) ? null : (
                  <SessionStat Icon={CountdownIcon} label="Countdown">
                    {timeLeftUntil(closesAt.toISOString())}
                  </SessionStat>
                )}
              </div>
            ) : null}
          </div>

          <div className="relative z-10 flex shrink-0 items-center justify-between p-6">
            {session.iconUri ? (
              // eslint-disable-next-line @next/next/no-img-element -- the gateway is env-configured, so no static remotePattern can cover it
              <img className="size-10 rounded-sm object-cover" src={session.iconUri} alt="" />
            ) : (
              <span className="type-caption text-fs-text-secondary tabular-nums">
                {shortenAddress(session.deployer)}
              </span>
            )}
            <div className="flex items-center gap-2">
              <span className="text-fs-accent text-sm">View</span>
              <ArrowIcon className="text-fs-accent size-4 [&_path]:fill-current" />
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

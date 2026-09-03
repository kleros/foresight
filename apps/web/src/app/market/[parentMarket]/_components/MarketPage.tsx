"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { isAddress } from "viem";

import { useSession } from "@/features/sessions/api/getSession";
import { useSessionStats } from "@/features/sessions/api/getSessionStats";
import { sessionStatus } from "@/features/sessions/utils/toSessionDetail";

import { paths } from "@/config/paths";

import { AdvancedSection } from "./AdvancedSection";
import { OptionCard } from "./OptionCard";
import { ParticipateSection } from "./ParticipateSection";
import { PredictCard } from "./PredictCard";
import { SessionHeader } from "./SessionHeader";

export function MarketPage({ parentMarket }: { parentMarket: string }) {
  const session = useSession(parentMarket);
  const stats = useSessionStats(session.data?.id);

  if (!isAddress(parentMarket, { strict: false }) || session.data === null) {
    return (
      <PageColumn>
        <PageMessage title="No session found" hint="There is no session at this address." />
      </PageColumn>
    );
  }

  /* A failed background refetch keeps the last good data; only error out with nothing to show. */
  if (session.data === undefined) {
    return (
      <PageColumn>
        {session.isError ? (
          <PageMessage
            title="Could not load this session"
            hint="Something went wrong on our side. Try again in a moment."
          />
        ) : (
          <MarketPageSkeleton />
        )}
      </PageColumn>
    );
  }

  const detail = session.data;

  return (
    <PageColumn>
      <SessionHeader
        session={detail}
        status={sessionStatus(detail, new Date())}
        stats={stats.data}
        statsPending={stats.isPending}
      />
      <div className="mt-12 flex flex-col gap-4">
        <ParticipateSection itemNamePlural={detail.itemNamePlural} />
        {detail.options.map((option) => (
          <OptionCard key={option.market} option={option} />
        ))}
        <PredictCard />
        <AdvancedSection parentMarket={detail.parentMarket} />
      </div>
    </PageColumn>
  );
}

function PageColumn({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-294 flex-col">{children}</div>;
}

function MarketPageSkeleton() {
  return (
    <div className="flex flex-col" aria-busy>
      <div className="flex flex-col gap-4">
        <div className="fs-skeleton h-9 w-3/5 max-w-120" />
        <div className="fs-skeleton h-5 w-2/5 max-w-80" />
        <div className="fs-skeleton h-72" />
      </div>
      <div className="mt-12 flex flex-col gap-4">
        <div className="fs-skeleton h-7 w-40" />
        <div className="fs-skeleton h-24" />
        <div className="fs-skeleton h-14" />
        <div className="fs-skeleton h-14" />
        <div className="fs-skeleton h-14" />
      </div>
    </div>
  );
}

function PageMessage({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="border-fs-border rounded-fs my-20 flex flex-col items-center gap-3 border p-13 text-center">
      <h1 className="text-fs-text-primary text-base font-semibold">{title}</h1>
      <p className="text-fs-text-secondary text-sm">{hint}</p>
      <Link href={paths.home.getHref()} className="type-label text-fs-accent">
        Browse sessions
      </Link>
    </div>
  );
}

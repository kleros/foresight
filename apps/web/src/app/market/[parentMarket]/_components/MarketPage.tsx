"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

import { isAddress } from "viem";

import { LiquidityBanner } from "@/features/liquidity/components/LiquidityBanner";
import { LiquidityDialog } from "@/features/liquidity/components/LiquidityDialog";
import { LiquiditySection } from "@/features/liquidity/components/LiquiditySection";
import { useSessionLiquidity } from "@/features/liquidity/hooks/useSessionLiquidity";
import { EstimateActions } from "@/features/predict/components/EstimateActions";
import { EstimateCsvDialog } from "@/features/predict/components/EstimateCsvDialog";
import { useEstimateHydration } from "@/features/predict/hooks/useEstimateHydration";
import { snapEstimate } from "@/features/predict/utils/estimates";
import { useSession } from "@/features/sessions/api/getSession";
import { useSessionChart } from "@/features/sessions/api/getSessionChart";
import { useSessionStats } from "@/features/sessions/api/getSessionStats";
import { useRenderAtClose } from "@/features/sessions/hooks/useRenderAtClose";
import { latestEstimates } from "@/features/sessions/utils/latestEstimates";
import { optionNoun, optionNounSingular } from "@/features/sessions/utils/optionNoun";
import { sessionStatus } from "@/features/sessions/utils/toSessionDetail";
import { TradeWallet } from "@/features/trade-executor/components/TradeWallet/TradeWallet";

import { LIQUIDITY_CLOSED_REASON } from "@/config/liquidity";
import { ADD_LIQUIDITY_PARAM, paths } from "@/config/paths";

import { AdvancedSection } from "./AdvancedSection";
import { OptionCard } from "./OptionCard";
import { ParticipateSection } from "./ParticipateSection";
import { PredictCard } from "./PredictCard";
import { SessionHeader } from "./SessionHeader";
import { toWalletMarket } from "./toWalletMarket";
import { useOptionPositions } from "./useOptionPositions";

const SessionChart = dynamic(() => import("@/features/sessions/components/SessionChart").then((m) => m.SessionChart), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

export function MarketPage({ parentMarket }: { parentMarket: string }) {
  const session = useSession(parentMarket);
  const stats = useSessionStats(session.data?.id);
  const chart = useSessionChart(session.data ?? undefined);
  const positions = useOptionPositions(session.data ?? undefined);
  useRenderAtClose(session.data?.closesAt);
  useEstimateHydration();
  const searchParams = useSearchParams();
  const [isAddingLiquidity, setAddingLiquidity] = useState(() => searchParams?.has(ADD_LIQUIDITY_PARAM) ?? false);
  const liquidity = useSessionLiquidity({
    parentMarket: parentMarket as `0x${string}`,
    branches: session.data?.options.map(({ market, outcomeIndex, name }) => ({ market, outcomeIndex, name })) ?? [],
    closesAt: session.data?.closesAt ?? null,
    isReady: session.data?.setupComplete ?? false,
  });

  if (!isAddress(parentMarket, { strict: false }) || session.data === null) {
    return (
      <PageColumn>
        <PageMessage title="No session found" hint="There is no session at this address." />
      </PageColumn>
    );
  }

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
  const status = sessionStatus(detail, new Date());
  const noun = optionNoun(detail.itemNamePlural);
  const walletMarket = toWalletMarket(detail);
  const addLiquidityReason =
    status === "closed"
      ? LIQUIDITY_CLOSED_REASON
      : !detail.setupComplete
        ? "The session is still being set up."
        : liquidity.pools.isError
          ? "Could not read the pools. Reload in a moment."
          : undefined;
  // the pool's number is an unbounded float; held on each option's grid so "at the market" is exact
  const latest = chart.data ? latestEstimates(chart.data) : {};
  const marketEstimates = Object.fromEntries(
    detail.options.flatMap((option) => {
      const raw = latest[option.market.toLowerCase()];
      return raw === undefined ? [] : [[option.market.toLowerCase(), snapEstimate(raw, option)]];
    }),
  ) as Record<string, number | undefined>;

  return (
    <PageColumn>
      <SessionHeader session={detail} status={status} stats={stats.data} statsPending={stats.isPending} />
      {liquidity.hasLiquidity === false ? (
        <LiquidityBanner reason={addLiquidityReason} onAdd={() => setAddingLiquidity(true)} />
      ) : null}
      {chart.isPending ? (
        <ChartSkeleton />
      ) : chart.isError ? (
        <p className="text-fs-text-secondary mt-6 text-sm">Could not load the price history. Reload in a moment.</p>
      ) : chart.data !== undefined ? (
        <SessionChart
          data={chart.data}
          startTime={Math.floor(detail.openedAt.getTime() / 1000)}
          endTime={detail.closesAt ? Math.floor(detail.closesAt.getTime() / 1000) : null}
          noun={noun}
        />
      ) : null}
      <section className="mt-12 flex flex-col gap-4">
        <ParticipateSection session={detail} />
        {detail.options.map((option) => (
          <OptionCard
            key={option.market}
            option={option}
            parentMarket={detail.parentMarket}
            status={status}
            marketEstimate={marketEstimates[option.market.toLowerCase()]}
            isMarketPending={chart.isPending}
            isMarketUnavailable={chart.isError}
            position={positions[option.market.toLowerCase()]}
            collateralDecimals={detail.collateralDecimals ?? undefined}
          />
        ))}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <EstimateCsvDialog
            parentMarket={detail.parentMarket}
            scales={detail.options}
            marketEstimates={marketEstimates}
            noun={noun}
            isDisabled={status === "setting-up"}
          />
          <EstimateActions
            parentMarket={detail.parentMarket}
            scales={detail.options}
            marketEstimates={marketEstimates}
            isDisabled={status !== "trading"}
          />
        </div>
        <PredictCard
          session={detail}
          status={status}
          marketEstimates={marketEstimates}
          isMarketUnknown={chart.data === undefined}
        />
        {walletMarket ? <TradeWallet market={walletMarket} noun={optionNounSingular(detail.itemName)} /> : null}
        <AdvancedSection parentMarket={detail.parentMarket} />
        <LiquiditySection
          reason={addLiquidityReason}
          onAdd={() => setAddingLiquidity(true)}
          names={liquidity.names}
          positions={liquidity.positions}
          merge={liquidity.merge}
          run={liquidity.run}
        />
      </section>
      <LiquidityDialog
        // opens once the pools are read, which it plans against
        isOpen={isAddingLiquidity && liquidity.pools.data !== undefined}
        onClose={() => setAddingLiquidity(false)}
        names={liquidity.names}
        pools={liquidity.pools.data}
        owner={liquidity.owner}
        balances={liquidity.balances}
        chainTime={liquidity.chainTime}
        closed={status === "closed"}
        run={liquidity.run}
      />
    </PageColumn>
  );
}

function PageColumn({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-294 flex-col">{children}</div>;
}

function ChartSkeleton() {
  return (
    <div className="mt-6 flex flex-col gap-2" aria-busy>
      <div className="fs-skeleton h-6 w-40" />
      <div className="fs-skeleton h-70 md:h-100" />
    </div>
  );
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
      <Link href={paths.home.getHref()} className="type-label text-fs-text-accent">
        Browse sessions
      </Link>
    </div>
  );
}

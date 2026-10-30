"use client";

import { Button, Tabs } from "@kleros/ui-components-library";

import { useSessionTrades } from "@/features/sessions/api/getSessionTrades";
import type { SessionDetail } from "@/features/sessions/types";

import { SectionCard } from "@/components/ui/SectionCard";

import { MyTrades } from "./MyTrades";
import { TradeList, TradeListSkeleton } from "./TradeList";

/** Every trade in the session, foresight's predictions and swaps made straight through the pools, newest first. */
function AllTrades({ session }: { session: SessionDetail }) {
  const trades = useSessionTrades(session.id);

  return (
    <div className="flex flex-col gap-3">
      {trades.isPending ? (
        <TradeListSkeleton />
      ) : trades.isError ? (
        <p className="text-fs-text-secondary text-sm">Could not load the trades. Reload in a moment.</p>
      ) : trades.data.length === 0 ? (
        <p className="text-fs-text-secondary text-sm">No trades yet.</p>
      ) : (
        <TradeList session={session} trades={trades.data} />
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
    </div>
  );
}

/** The session's trades in two tabs: everyone's, and the connected trade wallet's with its expected P&L. */
export function TradeHistory({ session }: { session: SessionDetail }) {
  return (
    <SectionCard className="flex flex-col gap-3 p-4 md:px-8">
      <Tabs
        className="w-full"
        panelClassName="pt-3"
        items={[
          { id: "all", value: "all", text: "All trades", content: <AllTrades session={session} /> },
          { id: "mine", value: "mine", text: "My trades", content: <MyTrades session={session} /> },
        ]}
      />
    </SectionCard>
  );
}

"use client";

import { skipToken, useQuery, type QueryClient } from "@tanstack/react-query";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { graphql } from "@/lib/graphql/generated";
import { STALE_TIME } from "@/lib/query";

import type { SessionStats } from "../types";
import { sessionChartKey } from "./getSessionChart";
import { toSessionStats } from "../utils/toSessionStats";

const SESSION_STATS = graphql(`
  query SessionStats($sessionId: String!) {
    Prediction(
      where: { childMarket: { session_id: { _eq: $sessionId } } }
      distinct_on: executor_id
      order_by: { executor_id: asc }
    ) {
      executor_id
    }
    Pool(where: { childMarket: { session_id: { _eq: $sessionId } } }) {
      id
      volumeUnderlying
    }
  }
`);

export const sessionStatsKey = (sessionId?: string) => ["session-stats", sessionId] as const;

const fetchSessionStats = async (sessionId: string) => toSessionStats(await fetchGraphql(SESSION_STATS, { sessionId }));

const POLL_MS = 5_000;
const POLL_ATTEMPTS = 12;

/**
 * The indexer lags the confirmed transaction, so an immediate refetch can return the old series.
 * Polls until the stats differ from what the page showed (or the attempts run out), then marks
 * the chart and stats stale. Runs on the query client, so it outlives the popup that started it.
 */
export async function refreshSessionAfterTrade(queryClient: QueryClient, sessionId: string) {
  const before = queryClient.getQueryData<SessionStats>(sessionStatsKey(sessionId));
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    try {
      const now = await fetchSessionStats(sessionId);
      if (!before || now.traders !== before.traders || now.volumeUnderlying !== before.volumeUnderlying) break;
    } catch {
      // keep polling; the final invalidation still refetches
    }
  }
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: sessionChartKey(sessionId) }),
    queryClient.invalidateQueries({ queryKey: sessionStatsKey(sessionId) }),
  ]);
}

export function useSessionStats(sessionId: string | undefined) {
  return useQuery({
    queryKey: sessionStatsKey(sessionId),
    queryFn: sessionId ? () => fetchSessionStats(sessionId) : skipToken,
    staleTime: STALE_TIME.live,
  });
}

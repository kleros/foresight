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
      childMarket_id
      outcomeToken
      underlyingToken
      outcomeIndex
      underlyingPerOutcome
      volumeUnderlying
      volumeOutcome
    }
  }
`);

export const sessionStatsKey = (sessionId?: string) => ["session-stats", sessionId] as const;

const fetchSessionStats = async (sessionId: string) => toSessionStats(await fetchGraphql(SESSION_STATS, { sessionId }));

const POLL_MS = 5_000;
const POLL_ATTEMPTS = 12;

/**
 * The indexer lags the confirmed transaction, and cached stats cannot say whether a change is this
 * prediction or someone else's. So it polls the whole window, marking the chart and stats stale each
 * time what the indexer serves moves, and once more at the end. Runs on the query client, so it
 * outlives the popup that started it.
 */
export async function refreshSessionAfterTrade(queryClient: QueryClient, sessionId: string) {
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionChartKey(sessionId) }),
      queryClient.invalidateQueries({ queryKey: sessionStatsKey(sessionId) }),
    ]);
  let seen = queryClient.getQueryData<SessionStats>(sessionStatsKey(sessionId));
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    try {
      const now = await fetchSessionStats(sessionId);
      if (
        !seen ||
        now.traders !== seen.traders ||
        now.volumeUnderlying !== seen.volumeUnderlying ||
        now.volumeOutcome !== seen.volumeOutcome
      ) {
        seen = now;
        await refresh();
      }
    } catch {
      // keep polling; the final invalidation still refetches
    }
  }
  await refresh();
}

export function useSessionStats(sessionId: string | undefined) {
  return useQuery({
    queryKey: sessionStatsKey(sessionId),
    queryFn: sessionId ? () => fetchSessionStats(sessionId) : skipToken,
    staleTime: STALE_TIME.live,
  });
}

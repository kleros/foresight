"use client";

import { skipToken, useQuery } from "@tanstack/react-query";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { graphql } from "@/lib/graphql/generated";
import { STALE_TIME } from "@/lib/query";

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

export function useSessionStats(sessionId: string | undefined) {
  return useQuery({
    queryKey: sessionStatsKey(sessionId),
    queryFn: sessionId ? async () => toSessionStats(await fetchGraphql(SESSION_STATS, { sessionId })) : skipToken,
    staleTime: STALE_TIME.live,
  });
}

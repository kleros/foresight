"use client";

import { skipToken, useQuery } from "@tanstack/react-query";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { graphql } from "@/lib/graphql/generated";
import { STALE_TIME } from "@/lib/query";

import type { SessionDetail } from "../types";
import { toSessionChart } from "../utils/toSessionChart";

// outcomeIndex 1 is the UP pool; its price in underlying is the scalar estimate used in app.
const UP_OUTCOME = 1;

const SESSION_CHART = graphql(`
  query SessionChart($sessionId: String!, $upOutcome: Int!) {
    Pool(where: { childMarket: { session_id: { _eq: $sessionId } }, outcomeIndex: { _eq: $upOutcome } }) {
      id
      childMarket_id
      underlyingPerOutcome
      updatedAt
      swaps(order_by: [{ timestamp: asc }, { logIndex: asc }]) {
        underlyingPerOutcomeAfter
        timestamp
      }
    }
  }
`);

const CHART_REFETCH_INTERVAL = 5 * 60_000;

export const sessionChartKey = (sessionId?: string) => ["session-chart", sessionId] as const;

export function useSessionChart(session: Pick<SessionDetail, "id" | "options"> | undefined) {
  return useQuery({
    queryKey: sessionChartKey(session?.id),
    queryFn: session
      ? async () =>
          toSessionChart(
            await fetchGraphql(SESSION_CHART, { sessionId: session.id, upOutcome: UP_OUTCOME }),
            session.options,
          )
      : skipToken,
    staleTime: STALE_TIME.live,
    refetchInterval: CHART_REFETCH_INTERVAL,
  });
}

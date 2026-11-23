"use client";

import { skipToken, useQueries } from "@tanstack/react-query";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { graphql } from "@/lib/graphql/generated";
import { STALE_TIME } from "@/lib/query";

import { toWinnerNames } from "../utils/toWinnerNames";

const SESSION_WINNERS = graphql(`
  query SessionWinners($sessionId: String!, $indexes: [numeric!]!) {
    Session(where: { id: { _eq: $sessionId } }, limit: 1) {
      outcomes
      children(where: { parentOutcomeIndex: { _in: $indexes } }) {
        parentOutcomeIndex
        parentOutcome
        displayName
      }
    }
  }
`);

export interface WinnerRead {
  sessionId: string;
  /** The parent's winning outcome indexes. */
  winners: readonly number[];
}

/** Each read's winning names, in the order given; undefined while unread, where it failed, or where no read is given. */
export function useWinnerNames(reads: ReadonlyArray<WinnerRead | undefined>): Array<string[] | undefined> {
  return useQueries({
    queries: reads.map((read) => ({
      queryKey: ["session-winners", read?.sessionId, read?.winners] as const,
      queryFn: read
        ? async () =>
            toWinnerNames(
              await fetchGraphql(SESSION_WINNERS, { sessionId: read.sessionId, indexes: read.winners.map(String) }),
              read.winners,
            ) ?? null
        : skipToken,
      // a resolved parent's winners are final
      staleTime: STALE_TIME.structural,
    })),
    combine: (results) => results.map((result) => result.data ?? undefined),
  });
}

"use client";

import { skipToken, useQueries } from "@tanstack/react-query";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { graphql } from "@/lib/graphql/generated";
import type { SessionWinnersQuery } from "@/lib/graphql/generated/graphql";
import { STALE_TIME } from "@/lib/query";

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

/**
 * The winning options' names in parent outcome order, as the market page names them; an option with no child
 * market goes by the parent's outcome name. Undefined where the indexer holds no such session.
 */
export function toWinnerNames(result: SessionWinnersQuery, winners: readonly number[]): string[] | undefined {
  const session = result.Session?.[0];
  if (session === undefined) return undefined;
  const childNames = new Map(
    session.children.map((child) => [Number(child.parentOutcomeIndex), child.displayName || child.parentOutcome]),
  );
  return [...winners]
    .sort((a, b) => a - b)
    .flatMap((index) => {
      const name = childNames.get(index) ?? session.outcomes[index];
      return name ? [name] : [];
    });
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

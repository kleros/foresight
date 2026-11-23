"use client";

import { skipToken, useQueries } from "@tanstack/react-query";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { graphql } from "@/lib/graphql/generated";
import { STALE_TIME } from "@/lib/query";

import type { ParentResolution } from "./getSessionResolution";

const OPTION_NAMES = graphql(`
  query SessionOptionNames($sessionId: String!) {
    ChildMarket(where: { session_id: { _eq: $sessionId } }) {
      parentOutcomeIndex
      parentOutcome
      displayName
    }
  }
`);

/**
 * Each session's winning options, named as the market page names them, in the order given; undefined until the
 * parent reads as resolved with a winner, while the names are read, or where their read failed.
 */
export function useWinningOptionNames(
  sessions: ReadonlyArray<{ id: string; parent: ParentResolution | Error | undefined }>,
): Array<string[] | undefined> {
  return useQueries({
    queries: sessions.map(({ id, parent }) => {
      const winners = parent && !(parent instanceof Error) && parent.resolved ? parent.winningOutcomes : [];
      return {
        queryKey: ["winning-option-names", id, winners],
        queryFn:
          winners.length > 0
            ? async () => {
                const { ChildMarket } = await fetchGraphql(OPTION_NAMES, { sessionId: id });
                return winners.flatMap((index) => {
                  const child = ChildMarket.find(({ parentOutcomeIndex }) => Number(parentOutcomeIndex) === index);
                  return child ? [child.displayName || child.parentOutcome] : [];
                });
              }
            : skipToken,
        staleTime: STALE_TIME.display,
      };
    }),
    combine: (results) => results.map((result) => result.data),
  });
}

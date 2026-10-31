"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { graphql } from "@/lib/graphql/generated";

import { IPFS_GATEWAY } from "@/config/ipfs";

import { LISTED_PARENT_MARKETS, legacySessions } from "../utils/curatedListing";
import { boundarySeconds, PER_PAGE, sessionWhere, type SessionFilters } from "../utils/listing";
import { toSessionSummary } from "../utils/toSessionSummary";

const SESSIONS = graphql(`
  query Sessions($limit: Int!, $offset: Int!, $where: Session_bool_exp!) {
    SessionCounter {
      count
    }
    Session(where: $where, order_by: { openedAt: desc }, limit: $limit, offset: $offset) {
      id
      parentMarket
      deployer
      marketName
      title
      description
      icon
      heroImage
      itemNamePlural
      outcomeCount
      keyword
      openingTime
    }
  }
`);

export function useSessions({ page, filters }: { page: number; filters: SessionFilters }) {
  const boundary = boundarySeconds(Date.now());
  const where = { ...sessionWhere(filters, boundary), parentMarket: { _in: LISTED_PARENT_MARKETS } };

  return useQuery({
    queryKey: ["sessions", page, where],
    queryFn: async () => {
      const result = await fetchGraphql(SESSIONS, {
        limit: PER_PAGE + 1,
        offset: (page - 1) * PER_PAGE,
        where,
      });

      const rows = result.Session;
      const hasNextPage = rows.length > PER_PAGE;
      const legacy = legacySessions(filters, boundary);
      const sessions = rows.slice(0, PER_PAGE).map((row) => toSessionSummary(row, IPFS_GATEWAY));

      return {
        sessions: hasNextPage ? sessions : [...sessions, ...legacy],
        hasNextPage,
        total: LISTED_PARENT_MARKETS.length + legacy.length,
      };
    },
    placeholderData: keepPreviousData,
  });
}

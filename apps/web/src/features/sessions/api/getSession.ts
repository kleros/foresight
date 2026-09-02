"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import { isAddress } from "viem";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { graphql } from "@/lib/graphql/generated";
import { STALE_TIME } from "@/lib/query";

import { IPFS_GATEWAY } from "@/config/ipfs";

import { toSessionDetail } from "../utils/toSessionDetail";

const SESSION_DETAIL = graphql(`
  query SessionDetail($parentMarket: String!) {
    Session(where: { parentMarket: { _eq: $parentMarket } }, limit: 1) {
      id
      parentMarket
      deployer
      marketName
      title
      description
      icon
      heroImage
      itemName
      itemNamePlural
      metadataResolved
      outcomeCount
      deployedChildCount
      openedAt
      completedAt
      openingTime
      blocks
      children(order_by: { parentOutcomeIndex: asc }) {
        id
        parentOutcomeIndex
        parentOutcome
        marketName
        lowerBound
        upperBound
        displayName
        color
        blocks
        upToken
        downToken
        underlyingToken
      }
    }
  }
`);

export const sessionKey = (parentMarket?: string) => ["session", parentMarket?.toLowerCase()] as const;

export function useSession(parentMarket: string | undefined) {
  const valid = parentMarket !== undefined && isAddress(parentMarket, { strict: false });

  return useQuery({
    queryKey: sessionKey(parentMarket),
    queryFn: valid
      ? async () => {
          const result = await fetchGraphql(SESSION_DETAIL, { parentMarket: parentMarket.toLowerCase() });
          const row = result.Session[0];
          return row ? toSessionDetail(row, IPFS_GATEWAY) : null;
        }
      : skipToken,
    staleTime: STALE_TIME.structural,
  });
}

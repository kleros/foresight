import { isAddress } from "viem";

import { env } from "@/config/env";
import { IPFS_GATEWAY } from "@/config/ipfs";

import type { SessionCore } from "../types";
import { toSessionCore, type SessionCoreRow } from "../utils/toSessionCore";

/**
 * Server-side reads for page metadata. They go through Next's fetch cache
 * instead of the client's batcher, and give up quickly: in Next 14 metadata
 * resolves before the page streams, so a slow indexer would hold the page.
 */

export const METADATA_TIMEOUT_MS = 1_500;
/** Seconds Next's data cache keeps an indexer answer. */
export const METADATA_REVALIDATE_S = 60;
const SITEMAP_REVALIDATE_S = 3_600;
const SITEMAP_LIMIT = 1_000;

const SESSION_METADATA = /* GraphQL */ `
  query SessionMetadata($parentMarket: String!) {
    Session(where: { parentMarket: { _eq: $parentMarket } }, limit: 1) {
      id
      parentMarket
      deployer
      marketName
      title
      description
      icon
      heroImage
      openingTime
    }
  }
`;

const SESSION_PATHS = /* GraphQL */ `
  query SessionPaths($limit: Int!) {
    Session(order_by: { openedAt: desc }, limit: $limit) {
      parentMarket
    }
  }
`;

async function subgraph<T>(query: string, variables: Record<string, unknown>, revalidate: number): Promise<T> {
  const response = await fetch(env.SUBGRAPH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    next: { revalidate },
  });
  if (!response.ok) throw new Error(`Subgraph answered ${response.status}`);
  const body = (await response.json()) as { data?: T; errors?: unknown };
  if (!body.data) throw new Error("Subgraph answered without data");
  return body.data;
}

export type SessionMetadataResult =
  { status: "found"; session: SessionCore } | { status: "missing" } | { status: "unavailable" };

/** Next memoizes GET fetches only; this POST is shared between metadata and page through the data cache. */
export async function getSessionMetadata(parentMarket: string): Promise<SessionMetadataResult> {
  if (!isAddress(parentMarket, { strict: false })) return { status: "missing" };
  try {
    const data = await subgraph<{ Session: SessionCoreRow[] }>(
      SESSION_METADATA,
      { parentMarket: parentMarket.toLowerCase() },
      METADATA_REVALIDATE_S,
    );
    const row = data.Session[0];
    return row ? { status: "found", session: toSessionCore(row, IPFS_GATEWAY) } : { status: "missing" };
  } catch (error) {
    console.error("Session metadata unavailable:", error);
    return { status: "unavailable" };
  }
}

/** @returns the newest sessions' parent markets, or none when the indexer does not answer. */
export async function getSessionPaths(): Promise<string[]> {
  try {
    const data = await subgraph<{ Session: { parentMarket: string }[] }>(
      SESSION_PATHS,
      { limit: SITEMAP_LIMIT },
      SITEMAP_REVALIDATE_S,
    );
    return data.Session.map(({ parentMarket }) => parentMarket);
  } catch (error) {
    console.error("Session paths unavailable:", error);
    return [];
  }
}

import type { Address } from "viem";

import type { GraphqlFetch } from "@/lib/graphql/batcher";
import { graphql } from "@/lib/graphql/generated";
import type { SessionByMetadataQuery } from "@/lib/graphql/generated/graphql";

import type { DeployedMarkets, SessionLookup } from "../flow/types";

/**
 * Whether a session already exists, answered by the indexer.
 *
 * An indexer that is behind has not seen a session that exists, so a null it
 * cannot stand behind is thrown instead. A match is returned at any lag.
 */

/**
 * Blocks the indexer may trail the chain by and still be believed about a null.
 * Tight on purpose: too strict costs a retry, too loose signs a second session.
 */
export const ACCEPTABLE_LAG = 2;

/** Clears by itself, so the run pauses on it rather than failing. */
export class IndexerNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndexerNotReadyError";
  }
}

/**
 * A read that failed says nothing about whether the next signature would, so it
 * is reported as the same kind of stop as an indexer that is merely behind.
 */
async function askIndexer<T>(ask: () => Promise<T>): Promise<T> {
  try {
    return await ask();
  } catch (cause) {
    throw new IndexerNotReadyError(
      `Could not check whether this session already exists: ${cause instanceof Error ? cause.message : cause}`,
    );
  }
}

const SESSION_BY_METADATA = graphql(`
  query SessionByMetadata($deployer: String!, $metadataUri: String!, $since: numeric!) {
    Session(
      where: { deployer: { _eq: $deployer }, metadataUri: { _eq: $metadataUri }, openedAt: { _gte: $since } }
      order_by: { openedAt: desc }
      limit: 1
    ) {
      sessionId
      parentMarket
      transactionHash
      children(order_by: { parentOutcomeIndex: asc }) {
        id
        parentOutcomeIndex
        transactionHash
      }
    }
    chain_metadata {
      latest_processed_block
      block_height
    }
  }
`);

/** @param head from a node: a stalled indexer reports a height as stale as its progress. */
function assertCaughtUp(metadata: SessionByMetadataQuery["chain_metadata"], head: number) {
  const chain = metadata[0];
  if (!chain || chain.latest_processed_block == null) {
    throw new IndexerNotReadyError("Could not tell how far the session data has caught up with the chain.");
  }

  // Both are lower bounds on the head, so the higher one is the floor.
  const chainHead = Math.max(head, chain.block_height ?? 0);
  const behind = chainHead - chain.latest_processed_block;
  if (behind > ACCEPTABLE_LAG) {
    throw new IndexerNotReadyError(`Still catching up with the chain, ${behind} blocks behind. Try again in a moment.`);
  }
}

/** @param chainHead read only when the indexer reports no session. */
export function createIndexerSessionLookup(fetch: GraphqlFetch, chainHead: () => Promise<bigint>): SessionLookup {
  return async ({ deployer, metadataUri, since }) => {
    const result = await askIndexer(() => fetch(SESSION_BY_METADATA, { deployer, metadataUri, since: String(since) }));

    const session = result.Session[0];
    if (session) {
      return {
        sessionId: BigInt(session.sessionId),
        parentMarket: session.parentMarket as Address,
        transactionHash: session.transactionHash,
        childMarkets: session.children.map((child) => ({
          outcomeIndex: Number(child.parentOutcomeIndex),
          address: child.id as Address,
          transactionHash: child.transactionHash,
        })),
      } satisfies DeployedMarkets;
    }

    assertCaughtUp(result.chain_metadata, Number(await chainHead()));
    return null;
  };
}

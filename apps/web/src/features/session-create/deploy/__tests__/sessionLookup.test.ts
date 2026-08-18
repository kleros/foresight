import { describe, expect, it } from "vitest";

import type { GraphqlFetch } from "@/lib/graphql/batcher";

import { ACCEPTABLE_LAG, createIndexerSessionLookup, IndexerNotReadyError } from "../sessionLookup";

/**
 * A false positive strands a session; a false negative signs a second one. Only
 * a negative depends on the indexer being caught up, so only it can throw.
 */

const ASKED = { deployer: "0xdeployer", metadataUri: "/ipfs/QmDoc", since: 1_700_000_000 } as const;

function indexerReturning(result: {
  sessions?: Array<{
    sessionId: string;
    parentMarket: string;
    children: Array<{ id: string; parentOutcomeIndex: string }>;
  }>;
  processed?: number | null;
  head?: number | null;
  /** The head from a node, the one account the indexer does not write. */
  chainHead?: number;
}) {
  const asked: Array<Record<string, unknown>> = [];

  const fetch = (async (_document: unknown, variables?: Record<string, unknown>) => {
    asked.push(variables ?? {});
    return {
      Session: result.sessions ?? [],
      chain_metadata: [
        {
          latest_processed_block: result.processed === undefined ? 100 : result.processed,
          block_height: result.head === undefined ? 100 : result.head,
        },
      ],
    };
    // Generic over any document; this one only sends the lookup query.
  }) as GraphqlFetch;

  const chainHead = () => Promise.resolve(BigInt(result.chainHead ?? result.head ?? 100));

  return { lookup: createIndexerSessionLookup(fetch, chainHead), asked };
}

describe("The indexer session lookup", () => {
  it("reports an existing session with its children", async () => {
    const { lookup } = indexerReturning({
      sessions: [
        {
          sessionId: "7",
          parentMarket: "0xparent",
          children: [
            { id: "0xchild0", parentOutcomeIndex: "0" },
            { id: "0xchild1", parentOutcomeIndex: "1" },
          ],
        },
      ],
    });

    expect(await lookup(ASKED)).toEqual({
      sessionId: 7n,
      parentMarket: "0xparent",
      childMarkets: [
        { outcomeIndex: 0, address: "0xchild0" },
        { outcomeIndex: 1, address: "0xchild1" },
      ],
    });
  });

  it("returns null when caught up with no match", async () => {
    const { lookup } = indexerReturning({ processed: 100, head: 100 });

    expect(await lookup(ASKED)).toBeNull();
  });

  it("throws rather than returning null while behind", async () => {
    const { lookup } = indexerReturning({ processed: 100 - (ACCEPTABLE_LAG + 1), head: 100 });

    await expect(lookup(ASKED)).rejects.toThrow(new RegExp(`${ACCEPTABLE_LAG + 1} blocks behind`));
  });

  it("returns a match found while behind", async () => {
    const { lookup } = indexerReturning({
      sessions: [{ sessionId: "7", parentMarket: "0xparent", children: [] }],
      processed: 100 - (ACCEPTABLE_LAG + 1),
      head: 100,
    });

    expect(await lookup(ASKED)).toMatchObject({ sessionId: 7n });
  });

  it("throws rather than believing an indexer whose own height has stopped moving", async () => {
    // Its height is as stale as its progress, so the two agree.
    const { lookup } = indexerReturning({
      processed: 100,
      head: 100,
      chainHead: 100 + ACCEPTABLE_LAG + 1,
    });

    await expect(lookup(ASKED)).rejects.toThrow(new RegExp(`${ACCEPTABLE_LAG + 1} blocks behind`));
  });

  it("measures against the indexer's height when a node of our own is behind it", async () => {
    const { lookup } = indexerReturning({ processed: 100 - (ACCEPTABLE_LAG + 1), head: 100, chainHead: 90 });

    await expect(lookup(ASKED)).rejects.toThrow(/blocks behind/);
  });

  it("throws when the indexer reports no progress", async () => {
    const { lookup } = indexerReturning({ processed: null });

    await expect(lookup(ASKED)).rejects.toThrow(/how far the session data has caught up/);
  });

  it("reports a subgraph that would not answer as an indexer that is not ready", async () => {
    const lookup = createIndexerSessionLookup(
      (() => Promise.reject(new Error("Key Session is not correctly prefixed"))) as GraphqlFetch,
      () => Promise.resolve(100n),
    );

    // Not `unknown`: a read that failed says nothing about the next signature.
    await expect(lookup(ASKED)).rejects.toBeInstanceOf(IndexerNotReadyError);
  });

  it("scopes the query to deployer, document and run start", async () => {
    const { lookup, asked } = indexerReturning({});

    await lookup(ASKED);

    expect(asked[0]).toEqual({ deployer: "0xdeployer", metadataUri: "/ipfs/QmDoc", since: "1700000000" });
  });
});

import type { Page } from "@playwright/test";
import { expect, test as base } from "@playwright/test";

import { chain } from "../utils/session-chain";

/**
 * Lag, a stall and an outage are forced: envio cannot be made to sit a chosen
 * number of blocks behind on demand.
 */

/** Where the app reads the subgraph, and where these tests ask it directly. */
export const INDEXER_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "http://localhost:8080/v1/graphql";

const INDEXER_ROUTE = "**/v1/graphql";

/** Only the fields a lag is measured from; the rest of the answer is the indexer's own. */
type ChainMetadata = { latest_processed_block: number; block_height: number };
type IndexerResponse = { data?: Record<string, unknown> };

/**
 * Concurrent queries are merged into one document and answered under aliases
 * (`_v0_Session`), so an entry is found by the name it ends with, not equals.
 */
function entriesNamed(data: Record<string, unknown>, field: string): string[] {
  return Object.keys(data).filter((key) => key === field || key.endsWith(`_${field}`));
}

async function processedBlock(): Promise<number> {
  const response = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "{ chain_metadata { latest_processed_block block_height } }" }),
  }).catch((cause: unknown) => {
    throw new Error(`The indexer at ${INDEXER_URL} is not answering (${String(cause)}). Is the local stack running?`);
  });

  const body = (await response.json()) as { data?: { chain_metadata?: ChainMetadata[] } };
  return body.data?.chain_metadata?.[0]?.latest_processed_block ?? -1;
}

export class IndexerFixture {
  constructor(private page: Page) {}

  /** Holds until the indexer has processed every block the chain has. */
  async caughtUp() {
    // Uncached: viem holds a block number for `cacheTime`.
    const head = Number(await chain.getBlockNumber({ cacheTime: 0 }));
    await expect
      .poll(processedBlock, { timeout: 60_000, message: `indexer never reached block ${head}` })
      .toBeGreaterThanOrEqual(head);
  }

  /**
   * Freezes the answer where it stands: no session, and a height as stale as
   * its progress. A crashed indexer or a stuck poller looks like this.
   */
  async stalls() {
    const stoppedAt = await processedBlock();

    await this.page.route(INDEXER_ROUTE, async (route) => {
      // The real answer is edited rather than replaced, so a merged query keeps
      // the aliases its caller splits the response back apart by.
      const response = await route.fetch();
      const body = (await response.json()) as IndexerResponse;
      const data = body.data ?? {};
      for (const key of entriesNamed(data, "Session")) data[key] = [];
      for (const key of entriesNamed(data, "chain_metadata")) {
        data[key] = [{ latest_processed_block: stoppedAt, block_height: stoppedAt }];
      }
      await route.fulfill({ response, json: body });
    });
  }

  /** Reports the indexer `blocks` behind the chain, leaving what it found intact. */
  async fallsBehind(blocks: number) {
    await this.page.route(INDEXER_ROUTE, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as IndexerResponse;
      for (const key of entriesNamed(body.data ?? {}, "chain_metadata")) {
        const metadata = (body.data?.[key] as ChainMetadata[] | undefined)?.[0];
        if (metadata) metadata.latest_processed_block = metadata.block_height - blocks;
      }
      await route.fulfill({ response, json: body });
    });
  }

  async goesDown() {
    await this.page.route(INDEXER_ROUTE, (route) => route.abort("connectionrefused"));
  }

  /** Hands the app back to the real indexer. */
  async comesBack() {
    await this.page.unroute(INDEXER_ROUTE);
  }
}

export const test = base.extend<{ indexer: IndexerFixture }>({
  indexer: async ({ page }, use) => {
    await use(new IndexerFixture(page));
  },
});

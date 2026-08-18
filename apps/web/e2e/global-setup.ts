import { INDEXER_URL } from "./fixtures/indexer";

/**
 * The indexer is a precondition.
 */
export default async function globalSetup() {
  const response = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "{ chain_metadata { latest_processed_block } }" }),
  }).catch(() => null);

  if (!response?.ok) {
    throw new Error(
      `No indexer at ${INDEXER_URL}. Start the local stack first:\n` +
        `  yarn local-stack        (chain, mock atlas, indexer, web)\n` +
        `  yarn indexer:dev        (just the indexer, if the rest is already up)`,
    );
  }
}

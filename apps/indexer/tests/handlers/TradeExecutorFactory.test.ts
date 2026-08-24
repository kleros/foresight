import { createTestIndexer } from "envio";
import { describe, it } from "vitest";

import { BLOCK, EXECUTOR, executorDeployed, indexEvents, OTHER_EXECUTOR, OTHER_OWNER, OWNER } from "../support/harness";

describe("TradeExecutorFactory indexing", () => {
  it("records the executor against the owner it was deployed for", async (t) => {
    const indexer = createTestIndexer();

    await indexEvents(indexer, [executorDeployed(OWNER, EXECUTOR, BLOCK)]);

    const executor = await indexer.Executor.getOrThrow(EXECUTOR);
    t.expect(executor.owner).toBe(OWNER);
    t.expect(executor.deployedAt).toBe(BigInt(BLOCK));
  });

  it("gives each executor its own row", async (t) => {
    const indexer = createTestIndexer();

    await indexEvents(indexer, [executorDeployed(OWNER, EXECUTOR), executorDeployed(OTHER_OWNER, OTHER_EXECUTOR)]);

    t.expect(await indexer.Executor.getAll()).toHaveLength(2);
  });
});

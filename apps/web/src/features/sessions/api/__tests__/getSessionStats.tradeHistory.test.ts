import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { refreshSessionAfterTrade } from "../getSessionStats";
import { sessionTradesKey } from "../getSessionTrades";
import { createFakeIndexer } from "./support/fakeIndexer";
import {
  SESSION_ID,
  OPTIONS,
  baseTables,
  executorRow,
  indexerAnswers,
  predictionRow,
  traderAddress,
  txHash,
  wei,
} from "./support/tradeHistoryFixtures";

/**
 * Acceptance test A5 of issue 2026-10-30-foresight-market-trade-history: the All trades list
 * refreshes once the user's prediction is indexed, because `refreshSessionAfterTrade` invalidates
 * `sessionTradesKey(sessionId)`, exported from `getSessionTrades`. That the history's query lives
 * under that key is held by `MarketPage.tradeHistoryKey.test.tsx`.
 */

vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));

const fetchMock = vi.mocked(fetchGraphql);
/** refreshSessionAfterTrade's poll interval; twenty intervals outlast every attempt. */
const POLL_MS = 5_000;
const OUTLAST_POLLING_MS = POLL_MS * 20;

const trader = traderAddress(0);
const NOW = Math.floor(Date.now() / 1000) - 60;

const traded = () => ({
  ...baseTables(),
  Executor: [executorRow(trader)],
  Prediction: [
    predictionRow({
      tx: txHash(1),
      executor: trader,
      option: OPTIONS.gerwig,
      timestamp: NOW,
      columns: { underlyingDelta: `-${wei("2")}` },
    }),
  ],
});

describe("refreshSessionAfterTrade and the All trades list", () => {
  let queryClient: QueryClient;
  let invalidated: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    queryClient = new QueryClient();
    invalidated = [];
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(async (filters) => {
      invalidated.push(JSON.stringify(filters?.queryKey));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invalidates the trade history once the indexer serves the new prediction", async () => {
    const fake = createFakeIndexer(baseTables());
    fetchMock.mockImplementation(indexerAnswers(fake) as typeof fetchGraphql);

    const done = refreshSessionAfterTrade(queryClient, SESSION_ID);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    const beforeIndexed = invalidated.length;
    const next = traded();
    fake.set("Executor", next.Executor);
    fake.set("Prediction", next.Prediction);
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(invalidated.slice(beforeIndexed)).toContain(JSON.stringify(sessionTradesKey(SESSION_ID)));
    await vi.advanceTimersByTimeAsync(OUTLAST_POLLING_MS);
    await done;
  });

  it("invalidates the trade history when polling ends without the indexer moving", async () => {
    fetchMock.mockImplementation(indexerAnswers(createFakeIndexer(baseTables())) as typeof fetchGraphql);

    const done = refreshSessionAfterTrade(queryClient, SESSION_ID);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    const afterFirstRead = invalidated.length;
    await vi.advanceTimersByTimeAsync(OUTLAST_POLLING_MS);
    await done;

    expect(invalidated.slice(afterFirstRead)).toContain(JSON.stringify(sessionTradesKey(SESSION_ID)));
  });
});

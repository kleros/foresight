import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { sessionChartKey } from "../getSessionChart";
import { refreshSessionAfterTrade, sessionStatsKey } from "../getSessionStats";

vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));

const SESSION = "session-1";
const POLL_MS = 5_000;

const served = (traders: number, volume: number) => ({
  Prediction: Array.from({ length: traders }, (_, i) => ({ executor_id: `0x${i}` })),
  Pool: [{ id: "pool", volumeUnderlying: String(volume) }],
});

describe("refreshSessionAfterTrade", () => {
  let queryClient: QueryClient;
  let invalidations: { key: unknown; reads: number }[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(fetchGraphql).mockReset();
    queryClient = new QueryClient();
    invalidations = [];
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(async (filters) => {
      invalidations.push({ key: filters?.queryKey, reads: vi.mocked(fetchGraphql).mock.calls.length });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const serveInOrder = (...responses: ReturnType<typeof served>[]) => {
    let read = 0;
    vi.mocked(fetchGraphql).mockImplementation(async () => responses[Math.min(read++, responses.length - 1)]!);
  };
  const keysInvalidated = () => invalidations.map((i) => JSON.stringify(i.key));
  const settle = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  it("invalidates nothing while the indexer still serves the pre-trade stats", async () => {
    queryClient.setQueryData(sessionStatsKey(SESSION), { traders: 1, volumeUnderlying: 10n });
    serveInOrder(served(1, 10));

    const done = refreshSessionAfterTrade(queryClient, SESSION);
    await settle(POLL_MS * 3);

    expect(invalidations).toEqual([]);
    await settle(POLL_MS * 20);
    await done;
  });

  it("invalidates the chart and the stats once the indexer serves the trade", async () => {
    queryClient.setQueryData(sessionStatsKey(SESSION), { traders: 1, volumeUnderlying: 10n });
    serveInOrder(served(1, 10), served(1, 10), served(2, 30));

    const done = refreshSessionAfterTrade(queryClient, SESSION);
    await settle(POLL_MS * 2);
    expect(invalidations).toEqual([]);
    await settle(POLL_MS);

    expect(keysInvalidated()).toEqual(
      expect.arrayContaining([JSON.stringify(sessionChartKey(SESSION)), JSON.stringify(sessionStatsKey(SESSION))]),
    );
    await settle(POLL_MS * 20);
    await done;
  });

  it("keeps watching past someone else's trade so this prediction is still refreshed once indexed", async () => {
    queryClient.setQueryData(sessionStatsKey(SESSION), { traders: 1, volumeUnderlying: 10n });
    serveInOrder(served(2, 20), served(2, 20), served(2, 30));

    const done = refreshSessionAfterTrade(queryClient, SESSION);
    await settle(POLL_MS * 20);
    await done;

    const lastReadWithTrade = 3;
    expect(Math.max(...invalidations.map((i) => i.reads))).toBeGreaterThanOrEqual(lastReadWithTrade);
    const afterOwnTrade = invalidations.filter((i) => i.reads >= lastReadWithTrade).map((i) => JSON.stringify(i.key));
    expect(afterOwnTrade).toEqual(
      expect.arrayContaining([JSON.stringify(sessionChartKey(SESSION)), JSON.stringify(sessionStatsKey(SESSION))]),
    );
  });

  it("refreshes when the page had no stats cached yet", async () => {
    serveInOrder(served(1, 10));

    const done = refreshSessionAfterTrade(queryClient, SESSION);
    await settle(POLL_MS);

    expect(keysInvalidated()).toContain(JSON.stringify(sessionStatsKey(SESSION)));
    await settle(POLL_MS * 20);
    await done;
  });

  it("still refreshes both once the attempts run out without the indexer moving", async () => {
    queryClient.setQueryData(sessionStatsKey(SESSION), { traders: 1, volumeUnderlying: 10n });
    serveInOrder(served(1, 10));

    const done = refreshSessionAfterTrade(queryClient, SESSION);
    await settle(POLL_MS * 20);
    await done;

    expect(keysInvalidated()).toEqual([
      JSON.stringify(sessionChartKey(SESSION)),
      JSON.stringify(sessionStatsKey(SESSION)),
    ]);
  });

  it("keeps polling through a failed read", async () => {
    queryClient.setQueryData(sessionStatsKey(SESSION), { traders: 1, volumeUnderlying: 10n });
    let read = 0;
    vi.mocked(fetchGraphql).mockImplementation(async () => {
      if (read++ === 0) throw new Error("indexer down");
      return served(2, 30);
    });

    const done = refreshSessionAfterTrade(queryClient, SESSION);
    await settle(POLL_MS * 2);

    expect(keysInvalidated()).toContain(JSON.stringify(sessionStatsKey(SESSION)));
    await settle(POLL_MS * 20);
    await done;
  });
});

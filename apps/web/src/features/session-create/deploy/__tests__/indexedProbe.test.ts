import { describe, expect, it } from "vitest";

import type { GraphqlFetch } from "@/lib/graphql/batcher";

import { deployInput, metadataInput } from "../../flow/__tests__/support/deployFixtures";
import type { SessionDeploySnapshot } from "../../flow/types";
import { createIndexedProbe, INDEXED_ATTEMPTS, INDEXED_DELAY_MS } from "../indexedProbe";

const BRANCHES = 3;

function snapshot(over: Partial<SessionDeploySnapshot> = {}): SessionDeploySnapshot {
  return {
    deploy: deployInput(BRANCHES),
    metadata: { ...metadataInput(BRANCHES), heroImage: "" },
    metadataUri: "/ipfs/QmDocument",
    childMarkets: [],
    mode: "atomic",
    startedAt: 0,
    sessionId: 7n,
    ...over,
  };
}

/**
 * Generic over any document, so the fake is cast; the probe still reads the
 * answer through the generated type, where a schema change fails to compile.
 *
 * @param rounds branch counts to answer with, in order. The last one repeats.
 */
function answering(rounds: Array<number | "error">) {
  const asked: number[] = [];
  const fetch = (async () => {
    const round = rounds[asked.length] ?? rounds[rounds.length - 1];
    asked.push(asked.length);
    if (round === "error") throw new Error("The subgraph did not answer.");
    if (round === undefined) return { Session: [] };
    return { Session: [{ id: "7", children: Array.from({ length: round }, (_, i) => ({ id: `0x${i}` })) }] };
  }) as unknown as GraphqlFetch;

  return {
    fetch,
    get asks() {
      return asked.length;
    },
  };
}

const probe = (fetch: GraphqlFetch, attempts = INDEXED_ATTEMPTS) =>
  createIndexedProbe(fetch, { attempts, delayMs: 0, sleep: () => Promise.resolve() });

describe("createIndexedProbe", () => {
  it("resolves once every branch the deploy created is in the subgraph", async () => {
    await expect(probe(answering([BRANCHES]).fetch)(snapshot())).resolves.toBeUndefined();
  });

  it("keeps waiting while the subgraph has the session but not all of its branches", async () => {
    const indexer = answering([BRANCHES - 1, BRANCHES - 1, BRANCHES]);

    await expect(probe(indexer.fetch)(snapshot())).resolves.toBeUndefined();

    // A session row on its own is not a page that can render.
    expect(indexer.asks).toBe(3);
  });

  it("waits between attempts rather than hammering the subgraph", async () => {
    const attempts = 4;
    const slept: number[] = [];
    const waiting = createIndexedProbe(answering([0]).fetch, {
      attempts,
      delayMs: INDEXED_DELAY_MS,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
    });

    await expect(waiting(snapshot())).rejects.toThrow();

    // Between the attempts, so one fewer than there are.
    expect(slept).toEqual(Array.from({ length: attempts - 1 }, () => INDEXED_DELAY_MS));
  });

  it("asks again after a subgraph that would not answer", async () => {
    await expect(probe(answering(["error", BRANCHES]).fetch)(snapshot())).resolves.toBeUndefined();
  });

  it("gives up rather than waiting forever on a subgraph that never catches up", async () => {
    const attempts = 3;

    await expect(probe(answering([0]).fetch, attempts)(snapshot())).rejects.toThrow(
      new RegExp(`has not appeared after ${attempts} attempts`),
    );
  });

  it("asks once per attempt and no more", async () => {
    const indexer = answering([0]);

    await expect(probe(indexer.fetch, 4)(snapshot())).rejects.toThrow();

    expect(indexer.asks).toBe(4);
  });

  it("refuses a session that never got an id", async () => {
    const indexer = answering([BRANCHES]);

    await expect(probe(indexer.fetch)(snapshot({ sessionId: undefined }))).rejects.toThrow(/never created/);
    expect(indexer.asks).toBe(0);
  });
});

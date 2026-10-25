import { beforeEach, describe, expect, it, vi } from "vitest";

import { encodeState } from "../codec";
import { StorageWriteError } from "../errors";
import { createFlowRunStore, createMemoryStorage, fromWebStorage, type FlowRunStorage } from "../storage";
import type { PersistedFlowRunInput } from "../types";
import { harness, step } from "./support/harness";

/**
 * A persisted run is the only record that an incomplete flow exists. Losing it
 * strands a half-deployed session; trusting a stale one re-signs work that is
 * already on chain.
 */

const HOUR = 60 * 60 * 1000;

function aRun(
  overrides: Partial<PersistedFlowRunInput<unknown, unknown>> = {},
): PersistedFlowRunInput<{ title: string; upperBound: bigint }, { chainId: number }> {
  return {
    flowId: "draft-1",
    adapterId: "session-create-flow",
    snapshot: { title: "Dune", upperBound: 500000000000000000000n },
    ctx: { chainId: 100 },
    status: "paused",
    reason: "requested",
    steps: [
      {
        stepId: "parent",
        label: "Deploy parent",
        outcome: { status: "confirmed", hash: "0xaaa", blockNumber: 19_000_000n },
      },
      { stepId: "batch-1", label: "Deploy children 1-6", outcome: { status: "pending" } },
    ],
    ...overrides,
  } as PersistedFlowRunInput<{ title: string; upperBound: bigint }, { chainId: number }>;
}

describe("createFlowRunStore", () => {
  let storage: FlowRunStorage;
  let clock: number;

  beforeEach(() => {
    storage = createMemoryStorage();
    clock = 1_700_000_000_000;
  });

  const store = () => createFlowRunStore({ storage, ttlMs: 72 * HOUR, now: () => clock });

  it("round-trips a run, bigints and all", () => {
    const s = store();
    s.save(aRun());

    const loaded = s.load("draft-1");

    expect(loaded?.snapshot).toEqual({ title: "Dune", upperBound: 500000000000000000000n });
    expect(loaded?.steps[0]?.outcome).toEqual({ status: "confirmed", hash: "0xaaa", blockNumber: 19_000_000n });
    expect(loaded?.steps[1]).toEqual({
      stepId: "batch-1",
      label: "Deploy children 1-6",
      outcome: { status: "pending" },
    });
  });

  it("stamps persistence time and expiry itself, so callers cannot backdate a run", () => {
    const s = store();
    s.save(aRun());

    const loaded = s.load("draft-1");

    expect(loaded?.persistedAt).toBe(clock);
    expect(loaded?.expiresAt).toBe(clock + 72 * HOUR);
  });

  it("returns null for a flow that was never saved", () => {
    expect(store().load("nobody")).toBeNull();
  });

  it("keeps a run readable right up to the TTL", () => {
    const s = store();
    s.save(aRun());
    clock += 72 * HOUR - 1;

    expect(s.load("draft-1")).not.toBeNull();

    clock += 2;
    expect(s.load("draft-1")).toBeNull();
  });

  it("auto-trashes an expired run rather than offering to resume it", () => {
    const s = store();
    s.save(aRun());
    clock += 72 * HOUR + 1;

    expect(s.load("draft-1")).toBeNull();
    // Gone from storage too, an expired run must not reappear in the gate.
    expect(storage.keys()).toHaveLength(0);
  });

  it("keeps an expired run while a step holds a hash with no receipt read, or a wallet prompt", () => {
    const s = store();
    const inFlight = (
      stepId: string,
      outcome: { status: "submitted"; hash: `0x${string}` } | { status: "awaiting-signature" },
    ) => aRun({ flowId: stepId, steps: [{ stepId: "parent", label: "Deploy parent", outcome }] });
    s.save(inFlight("sent", { status: "submitted", hash: "0xabc" }));
    s.save(inFlight("prompted", { status: "awaiting-signature" }));
    clock += 73 * HOUR;

    expect(s.load("sent")).not.toBeNull();
    expect(
      s
        .list()
        .map((r) => r.flowId)
        .sort(),
    ).toEqual(["prompted", "sent"]);
  });

  it("keeps an expired run the caller says is still unsettled, and prunes it once it is not", () => {
    let unsettled = true;
    const s = createFlowRunStore({ storage, ttlMs: 72 * HOUR, now: () => clock, unsettled: () => unsettled });
    s.save(aRun());
    clock += 73 * HOUR;

    expect(s.load("draft-1")).not.toBeNull();
    unsettled = false;
    expect(s.load("draft-1")).toBeNull();
    expect(storage.keys()).toHaveLength(0);
  });

  it("updates the expiry time for a run which is resumed", () => {
    const s = store();
    s.save(aRun());
    clock += 71 * HOUR;
    s.save(aRun());
    clock += 71 * HOUR;

    expect(s.load("draft-1")).not.toBeNull();
  });

  it("lists live runs and prunes expired ones", () => {
    const s = store();
    s.save(aRun({ flowId: "old" }));
    clock += 73 * HOUR;
    s.save(aRun({ flowId: "fresh" }));

    expect(s.list().map((r) => r.flowId)).toEqual(["fresh"]);
    expect(storage.keys()).toHaveLength(1);
  });

  it("drops unreadable/broken storage items", () => {
    const s = store();
    s.save(aRun());
    storage.setItem(storage.keys()[0] as string, "{ not json");

    expect(s.load("draft-1")).toBeNull();
    expect(storage.keys()).toHaveLength(0);
  });

  it("drops a run written by an older schema", () => {
    const s = store();
    s.save(aRun());
    const key = storage.keys()[0] as string;
    const raw = JSON.parse(storage.getItem(key) as string) as { version: number };
    storage.setItem(key, JSON.stringify({ ...raw, version: raw.version - 1 }));

    expect(s.load("draft-1")).toBeNull();
  });

  it("drops a record that parses but is missing what a resume needs", () => {
    // A half-written entry: right version, right expiry, no step list. Parsing
    // is not the same as usable, and restore has no way back from this.
    storage.setItem(
      "foresight.tx-flow.draft-1",
      encodeState({ ...aRun(), steps: null, version: 1, persistedAt: clock, expiresAt: clock + HOUR }),
    );

    expect(store().load("draft-1")).toBeNull();
    // Removed too, or every later load hits the same wall.
    expect(storage.getItem("foresight.tx-flow.draft-1")).toBeNull();
  });

  it("drops a record whose steps are not step summaries", () => {
    storage.setItem(
      "foresight.tx-flow.draft-1",
      encodeState({
        ...aRun(),
        steps: [{ stepId: "parent", label: "Deploy parent", outcome: { status: "invented" } }],
        version: 1,
        persistedAt: clock,
        expiresAt: clock + HOUR,
      }),
    );

    expect(store().load("draft-1")).toBeNull();
  });

  it("drops a paused record with no reason, since the phase would be unreadable", () => {
    const { flowId, adapterId, snapshot, ctx, steps } = aRun();
    storage.setItem(
      "foresight.tx-flow.draft-1",
      encodeState({
        flowId,
        adapterId,
        snapshot,
        ctx,
        steps,
        status: "paused",
        version: 1,
        persistedAt: clock,
        expiresAt: clock + HOUR,
      }),
    );

    expect(store().load("draft-1")).toBeNull();
  });

  it("drops a submitted step that carries no hash", () => {
    // The status alone is not enough: reconciliation reads the hash off this
    // the moment the run comes back, and there would be nothing there.
    storage.setItem(
      "foresight.tx-flow.draft-1",
      encodeState({
        ...aRun(),
        steps: [{ stepId: "parent", label: "Deploy parent", outcome: { status: "submitted" } }],
        version: 1,
        persistedAt: clock,
        expiresAt: clock + HOUR,
      }),
    );

    expect(store().load("draft-1")).toBeNull();
  });

  it("drops a confirmed step with no block number", () => {
    storage.setItem(
      "foresight.tx-flow.draft-1",
      encodeState({
        ...aRun(),
        steps: [{ stepId: "parent", label: "Deploy parent", outcome: { status: "confirmed", hash: "0xaaa" } }],
        version: 1,
        persistedAt: clock,
        expiresAt: clock + HOUR,
      }),
    );

    expect(store().load("draft-1")).toBeNull();
  });

  it("drops a record that lost its snapshot", () => {
    const { snapshot: _snapshot, ...rest } = aRun();
    storage.setItem(
      "foresight.tx-flow.draft-1",
      encodeState({ ...rest, version: 1, persistedAt: clock, expiresAt: clock + HOUR }),
    );

    expect(store().load("draft-1")).toBeNull();
  });

  it("drops a record filed under the wrong key", () => {
    storage.setItem(
      "foresight.tx-flow.draft-1",
      encodeState({ ...aRun(), flowId: "some-other-flow", version: 1, persistedAt: clock, expiresAt: clock + HOUR }),
    );

    expect(store().load("draft-1")).toBeNull();
  });

  it("clears one flow without touching the others", () => {
    const s = store();
    s.save(aRun({ flowId: "a" }));
    s.save(aRun({ flowId: "b" }));

    s.clear("a");

    expect(s.load("a")).toBeNull();
    expect(s.load("b")).not.toBeNull();
  });

  it("namespaces its keys and leaves the rest of storage alone", () => {
    storage.setItem("someone-elses-key", "keep me");
    const s = store();
    s.save(aRun());

    expect(storage.keys().some((k) => k.startsWith("foresight.tx-flow."))).toBe(true);

    s.clearAll();

    expect(storage.getItem("someone-elses-key")).toBe("keep me");
    expect(s.list()).toEqual([]);
  });
});

function mockLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  };
}

describe("fromWebStorage", () => {
  it("adapts local storage", () => {
    const port = fromWebStorage(mockLocalStorage());

    port.setItem("a", "1");
    port.setItem("b", "2");

    expect(port.keys().sort()).toEqual(["a", "b"]);
    expect(port.getItem("a")).toBe("1");

    port.removeItem("a");
    expect(port.getItem("a")).toBeNull();
  });
});

/**
 * The write before the wallet opens is the only record that a prompt may be out there, so a run whose
 * store refuses it opens no wallet. Every later write only costs the safety net, and the run carries on.
 */
describe("a run whose storage refuses to write", () => {
  const refusing = (refuses: (value: string) => boolean): FlowRunStorage => {
    const memory = createMemoryStorage();
    return {
      ...memory,
      setItem: (key, value) => {
        if (refuses(value)) throw new DOMException("quota", "QuotaExceededError");
        memory.setItem(key, value);
      },
    };
  };

  it("opens no wallet when the write before the prompt fails, and pauses to be tried again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness({ storage: refusing(() => true) });

    await h.start([step("a"), step("b")]);

    expect(h.gateway.signRequests).toEqual([]);
    expect(h.orchestrator.getStatus()).toBe("paused");
    const run = h.orchestrator.getRun();
    expect(run?.status === "paused" && run.error).toMatchObject({ stepId: "a", cause: "rpc" });
  });

  it("finishes when only writes after the prompt fail, and says once what was given up", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness({ storage: refusing((value) => value.includes('"submitted"')) });

    await h.start([step("a"), step("b")]);

    expect(h.orchestrator.getStatus()).toBe("completed");
    expect(h.gateway.signRequests).toHaveLength(2);
    expect(h.events.filter((event) => event.type === "inform")).toHaveLength(1);
  });

  it("throws from a snapshot update asked to be durable when it cannot be saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let full = false;
    const h = harness({ storage: refusing(() => full), scripts: [{ sign: "reject" }] });
    await h.start([step("a")]);
    full = true;

    expect(() => h.orchestrator.updateSnapshot({ title: "Arrakis" }, { source: "adapter", durable: true })).toThrow(
      StorageWriteError,
    );
    expect(() => h.orchestrator.updateSnapshot({ title: "Arrakis" }, { source: "adapter" })).not.toThrow();
  });
});

import { createFlowRunStore, createMemoryStorage, type RunPhase, type StepOutcome } from "@foresight/tx-orchestrator";
import { describe, expect, it } from "vitest";

import { ctx, snapshot, WAD } from "../../flow/__tests__/support/fakes";
import {
  discardRun,
  findInterruptedRun,
  hasPendingTransaction,
  legacyPredictFlowId,
  predictFlowId,
} from "../interrupted";

const OWNER = "0xA11ce000000000000000000000000000000A11CE";
const OTHER = "0xb0b00000000000000000000000000000000000b0";
const SAVED = snapshot({ deposit: WAD * 3n });

type PersistedPhase = Exclude<RunPhase, { status: "completed" }>;

const HASH = `0x${"ab".repeat(32)}` as const;

function storeWith(
  flowId: string,
  owner: `0x${string}`,
  deposit: StepOutcome = { status: "pending" },
  phase: PersistedPhase = { status: "running" },
) {
  const store = createFlowRunStore({ storage: createMemoryStorage() });
  store.save({
    flowId,
    adapterId: "predict-flow",
    snapshot: SAVED,
    ctx: ctx({ owner }),
    steps: [
      { stepId: "deposit", label: "Add funds", outcome: deposit },
      { stepId: "predict", label: "Predict", outcome: { status: "pending" } },
    ],
    ...phase,
  });
  return store;
}

const submitted: StepOutcome = { status: "submitted", hash: HASH };
const halted: PersistedPhase = {
  status: "paused",
  reason: "error",
  error: { stepId: "deposit", message: "RPC unavailable", cause: "rpc", hash: HASH },
};
const reverted: PersistedPhase = {
  status: "failed",
  error: { stepId: "deposit", message: "The transaction reverted on chain.", cause: "reverted", hash: HASH },
};

describe("findInterruptedRun", () => {
  it("returns the stored snapshot of the owner's run for the session, whatever the address's case", () => {
    const store = storeWith(predictFlowId("7", OWNER), OWNER);

    expect(findInterruptedRun(store, "7", OWNER.toLowerCase() as `0x${string}`)).toEqual(SAVED);
  });

  it("returns nothing for another owner's run", () => {
    expect(findInterruptedRun(storeWith(predictFlowId("7", OWNER), OWNER), "7", OTHER)).toBeNull();
  });

  it("returns nothing for another session's run", () => {
    expect(findInterruptedRun(storeWith(predictFlowId("8", OWNER), OWNER), "7", OWNER)).toBeNull();
  });
});

describe("runs saved under the session-only key", () => {
  it("are still found for their owner", () => {
    expect(findInterruptedRun(storeWith(legacyPredictFlowId("7"), OWNER), "7", OWNER)).toEqual(SAVED);
  });

  it("are not found for another owner", () => {
    expect(findInterruptedRun(storeWith(legacyPredictFlowId("7"), OWNER), "7", OTHER)).toBeNull();
  });
});

describe("discardRun", () => {
  it("forgets the owner's run under either key", () => {
    for (const key of [predictFlowId("7", OWNER), legacyPredictFlowId("7")]) {
      const store = storeWith(key, OWNER);
      discardRun(store, "7", OWNER);
      expect(store.load(key)).toBeNull();
    }
  });

  it("leaves another owner's session-only run alone", () => {
    const store = storeWith(legacyPredictFlowId("7"), OWNER);
    discardRun(store, "7", OTHER);
    expect(store.load(legacyPredictFlowId("7"))).not.toBeNull();
  });
});

describe("a run whose transaction has not reconciled", () => {
  it("is reported as pending for its owner under either key", () => {
    for (const key of [predictFlowId("7", OWNER), legacyPredictFlowId("7")]) {
      expect(hasPendingTransaction(storeWith(key, OWNER, submitted, halted), "7", OWNER)).toBe(true);
    }
  });

  it("is kept when discarded", () => {
    for (const key of [predictFlowId("7", OWNER), legacyPredictFlowId("7")]) {
      const store = storeWith(key, OWNER, submitted, halted);
      discardRun(store, "7", OWNER);
      expect(store.load(key)).not.toBeNull();
    }
  });
});

describe("a run with nothing awaiting a receipt", () => {
  const settled = [
    ["nothing was submitted", { status: "pending" }, { status: "running" }],
    ["the deposit confirmed", { status: "confirmed", hash: HASH, blockNumber: 1n }, { status: "running" }],
    ["the deposit reverted", { status: "pending" }, reverted],
  ] as const satisfies ReadonlyArray<readonly [string, StepOutcome, PersistedPhase]>;

  it.each(settled)("is not pending when %s", (_name, deposit, phase) => {
    expect(hasPendingTransaction(storeWith(predictFlowId("7", OWNER), OWNER, deposit, phase), "7", OWNER)).toBe(false);
  });

  it.each(settled)("is forgotten when discarded after %s", (_name, deposit, phase) => {
    const store = storeWith(predictFlowId("7", OWNER), OWNER, deposit, phase);
    discardRun(store, "7", OWNER);
    expect(store.load(predictFlowId("7", OWNER))).toBeNull();
  });
});

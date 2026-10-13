import { createFlowRunStore, createMemoryStorage } from "@foresight/tx-orchestrator";
import { describe, expect, it } from "vitest";

import { ctx, snapshot, WAD } from "../../flow/__tests__/support/fakes";
import { discardRun, findInterruptedRun, legacyPredictFlowId, predictFlowId } from "../interrupted";

const OWNER = "0xA11ce000000000000000000000000000000A11CE";
const OTHER = "0xb0b00000000000000000000000000000000000b0";
const SAVED = snapshot({ deposit: WAD * 3n });

function storeWith(flowId: string, owner: `0x${string}`) {
  const store = createFlowRunStore({ storage: createMemoryStorage() });
  store.save({
    flowId,
    adapterId: "predict-flow",
    snapshot: SAVED,
    ctx: ctx({ owner }),
    steps: [{ stepId: "deposit", label: "Add funds", outcome: { status: "pending" } }],
    status: "running",
  });
  return store;
}

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

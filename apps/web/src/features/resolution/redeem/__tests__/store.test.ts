import { DEFAULT_RUN_TTL_MS, type PersistedFlowRunInput, type StepSummary } from "@foresight/tx-orchestrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { redeemRunStore } from "../store";

const NOW = 1_700_000_000_000;
const pending: StepSummary["outcome"] = { status: "pending" };
const confirmed: StepSummary["outcome"] = { status: "confirmed", hash: `0x${"1".repeat(64)}`, blockNumber: 3n };

function save(id: string, snapshot: object, steps: StepSummary[]) {
  const run: PersistedFlowRunInput<object, object> = {
    flowId: id,
    adapterId: "redeem-flow",
    snapshot,
    ctx: {},
    steps,
    status: "paused",
    reason: "rejected",
  };
  redeemRunStore().save(run);
}

const step = (stepId: string, outcome: StepSummary["outcome"] = pending): StepSummary => ({
  stepId,
  label: stepId,
  outcome,
});
const SEND = { tx: { to: "0x00000000000000000000000000000000000000c1" }, nonce: 4, fromBlock: 9n };

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

const afterExpiry = () => vi.setSystemTime(NOW + DEFAULT_RUN_TTL_MS + 1);

describe("redeemRunStore R7 keeps a run that may still land past its expiry", () => {
  it("keeps a run holding a send whose step has not settled", () => {
    save("held", { sends: { "call:1": SEND } }, [step("call:0", confirmed), step("call:1")]);
    afterExpiry();

    expect(redeemRunStore().load("held")).not.toBeNull();
  });

  it("keeps a run holding a batch id whose batch has not settled", () => {
    save("batch", { sends: {}, callsId: "0xab" }, [step("batch")]);
    afterExpiry();

    expect(redeemRunStore().load("batch")).not.toBeNull();
  });

  it("lets a run whose sends all settled expire", () => {
    save("done", { sends: { "call:0": SEND } }, [step("call:0", confirmed), step("call:1")]);
    afterExpiry();

    expect(redeemRunStore().load("done")).toBeNull();
  });

  it("lets a run holding no send expire", () => {
    save("empty", { sends: {} }, [step("call:0")]);
    afterExpiry();

    expect(redeemRunStore().load("empty")).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";

import { hashFor } from "./support/fakeGateway";
import { doneIds, harness, outcomeOf, step } from "./support/harness";

describe("replacement chains", () => {
  it.each([
    ["cancelled", "repriced"],
    ["replaced", "repriced"],
    ["repriced", "cancelled"],
    ["repriced", "replaced"],
  ] as const)("does not complete after %s followed by %s", async (reason, next) => {
    const h = harness();
    const wait = h.gateway.waitForReceipt;
    h.gateway.waitForReceipt = async (args) => {
      args.onReplaced?.({ reason, hash: hashFor(100) });
      args.onReplaced?.({ reason: next, hash: hashFor(101) });
      return wait({ ...args, hash: hashFor(101), onReplaced: undefined });
    };
    await h.start([step("a"), step("b")]);
    expect(h.orchestrator.getRun()).toMatchObject({ status: "paused", reason: "cancelled" });
    expect(doneIds(h.orchestrator.getRun())).toEqual([]);
    expect(h.gateway.signRequests).toHaveLength(1);
  });

  it.each(["cancelled", "replaced"] as const)(
    "reconciles a persisted %s receipt without completing the money step",
    async (reason) => {
      const first = harness();
      first.gateway.waitForReceipt = async ({ onReplaced }) => {
        onReplaced?.({ reason, hash: hashFor(100) });
        first.orchestrator.pause();
        throw new Error("tab closed");
      };
      await first.start([step("a"), step("b")]);
      const afterStep = vi.fn();
      const second = harness({ storage: first.storage, hooks: { afterStep } });
      second.gateway.setChainState(hashFor(100), { receipt: "success" });
      second.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] });
      const result = await second.orchestrator.reconcileInFlight();
      expect(result).toEqual({ outcome: "cancelled", stepId: "a", hash: hashFor(100) });
      expect(second.orchestrator.getRun()).toMatchObject({
        status: "paused",
        reason: "cancelled",
        error: { stepId: "a", cause: "cancelled", hash: hashFor(100) },
      });
      expect(outcomeOf(second.orchestrator.getRun(), "a")).toEqual({ status: "pending" });
      expect(second.store.load("flow-1")).toMatchObject({
        status: "paused",
        reason: "cancelled",
        steps: [
          { stepId: "a", outcome: { status: "pending" } },
          { stepId: "b", outcome: { status: "pending" } },
        ],
      });
      expect(second.types()).toContain("step:failed");
      expect(second.events).toContainEqual({ type: "flow:paused", reason: "cancelled" });
      expect(afterStep).not.toHaveBeenCalled();
      expect(second.gateway.signRequests).toEqual([]);
    },
  );
});

it("confirms a persisted repricing receipt as the original money step", async () => {
  const first = harness();
  first.gateway.waitForReceipt = async ({ onReplaced }) => {
    onReplaced?.({ reason: "repriced", hash: hashFor(100) });
    first.orchestrator.pause();
    throw new Error("tab closed");
  };
  await first.start([step("a"), step("b")]);
  const afterStep = vi.fn();
  const second = harness({ storage: first.storage, hooks: { afterStep } });
  second.gateway.setChainState(hashFor(100), { receipt: "success" });
  second.orchestrator.restore({ flowId: "flow-1", steps: [step("a"), step("b")] });

  expect(await second.orchestrator.reconcileInFlight()).toEqual({
    outcome: "confirmed",
    stepId: "a",
    hash: hashFor(100),
  });
  expect(doneIds(second.orchestrator.getRun())).toEqual(["a"]);
  expect(afterStep).toHaveBeenCalledTimes(1);
  expect(second.gateway.signRequests).toEqual([]);
});

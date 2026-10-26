import { createFlowRunStore, createMemoryStorage, type TxGateway } from "@foresight/tx-orchestrator";
import { describe, expect, it, vi } from "vitest";

import { ctx, fakeQuoter, fakeReader, option, snapshot } from "../../flow/__tests__/support/fakes";
import { planPredict, STEP_ID } from "../../flow/plan";
import { createPredictRun } from "../driver";

describe("stored prediction step integrity", () => {
  it.each(["missing", "duplicate"])(
    "refuses a %s prediction step before sending the saved deposit",
    async (corruption) => {
      const storage = createMemoryStorage();
      const store = createFlowRunStore({ storage });
      const flowId = "incomplete-prediction";
      const reader = fakeReader({ deployed: true });
      const quoter = fakeQuoter();
      const steps = planPredict(snapshot(), { reader, quoter }).map((step) => ({
        stepId: step.id,
        label: step.label,
        outcome: { status: "pending" as const },
      }));
      store.save({
        flowId,
        adapterId: "predict-flow",
        status: "paused",
        reason: "rejected",
        ctx: ctx(),
        snapshot: snapshot(),
        steps,
      });
      const key = storage.keys()[0]!;
      const raw = JSON.parse(storage.getItem(key)!);
      const prediction = raw.steps.find((step: { stepId: string }) => step.stepId === STEP_ID.predict(1));
      raw.steps =
        corruption === "missing"
          ? raw.steps.filter((step: { stepId: string }) => step.stepId !== STEP_ID.predict(1))
          : [...raw.steps, prediction];
      storage.setItem(key, JSON.stringify(raw));
      const evidence = storage.getItem(key);
      const gateway: TxGateway = {
        sendTransaction: vi.fn(),
        waitForReceipt: vi.fn(),
        getReceipt: vi.fn(),
        isKnown: vi.fn(),
      };
      const onComplete = vi.fn();
      const driver = createPredictRun({
        store,
        flowId,
        gateway,
        reader,
        quoter,
        ctx: () => ctx(),
        snapshot: () => snapshot(),
        sessionOptions: () => [option(1)],
        onComplete,
      });
      try {
        driver.recover();
        await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("unknown"));
        driver.resume();
        expect(gateway.sendTransaction).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
        expect(storage.getItem(key)).toBe(evidence);
        driver.reset();
        expect(storage.getItem(key)).toBe(evidence);
      } finally {
        driver.dispose();
      }
    },
  );
});

import { createFlowRunStore, createMemoryStorage, type TxGateway } from "@foresight/tx-orchestrator";
import type { Hash, TransactionReceipt } from "viem";
import { describe, expect, it, vi } from "vitest";

import { addresses, ctx, fakeQuoter, fakeReader, snapshot } from "../../flow/__tests__/support/fakes";
import { planPredict, STEP_ID } from "../../flow/plan";
import type { SentTx } from "../../flow/types";
import { createPredictRun } from "../driver";

describe("Discard across popup disposal", () => {
  it.each(["receipt", "reverted", "taken", "pending", "unseen", "error"] as const)(
    "finishes reconciliation and releases ownership when the send is %s",
    async (mode) => {
      const store = createFlowRunStore({ storage: createMemoryStorage() });
      const flowId = "discard-dispose";
      const hash = `0x${"a".repeat(64)}` as Hash;
      let discarding = false;
      const quoter = fakeQuoter();
      const reader = {
        ...fakeReader({ deployed: true }),
        sentWithNonce: async ({ nonce }: { nonce: number }): Promise<SentTx> => ({
          status: discarding && mode === "taken" && nonce === 0 ? "taken" : "none",
        }),
      };
      const request = snapshot({
        sent: {
          [STEP_ID.deposit]: {
            owner: addresses.owner,
            nonce: 0,
            fromBlock: 1n,
            heldAt: Date.now(),
            tx: { to: addresses.collateral },
          },
        },
      });
      const steps = planPredict(request, { reader, quoter });
      store.save({
        flowId,
        adapterId: "predict-flow",
        status: "paused",
        reason: "interrupted",
        ctx: ctx(),
        snapshot: request,
        steps: steps.map((step) => ({
          stepId: step.id,
          label: step.label,
          outcome:
            step.id === STEP_ID.deposit
              ? { status: "submitted" as const, hash }
              : step.id === STEP_ID.createExecutor
                ? { status: "skipped" as const }
                : { status: "pending" as const },
        })),
      });
      let finish!: (receipt: TransactionReceipt | null) => void;
      let fail!: (error: Error) => void;
      const result = new Promise<TransactionReceipt | null>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      const gateway: TxGateway = {
        sendTransaction: vi.fn(),
        waitForReceipt: vi.fn(),
        isKnown: async () => discarding && mode === "pending",
        getReceipt: vi.fn(async () => (discarding ? result : null)),
      };
      const released = vi.fn();
      const driver = createPredictRun({
        gateway,
        store,
        reader,
        quoter,
        flowId,
        ctx: () => ctx(),
        snapshot: () => request,
        ownership: { claim: async () => released, heldElsewhere: async () => false, heldHere: () => true },
      });
      try {
        driver.recover();
        await vi.waitFor(() => expect(driver.getProgress().stage).toBe("review"));
        driver.resume();
        await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("unseen"));
        discarding = true;
        driver.discard();
        driver.dispose();
        const releasedBeforeRead = released.mock.calls.length;
        if (mode === "error") fail(new Error("RPC unavailable"));
        else {
          finish(
            mode === "receipt" || mode === "reverted"
              ? ({
                  transactionHash: hash,
                  status: mode === "receipt" ? "success" : "reverted",
                  blockNumber: 10n,
                  logs: [],
                } as unknown as TransactionReceipt)
              : null,
          );
        }
        if (mode === "receipt" || mode === "reverted" || mode === "taken") {
          await vi.waitFor(() => expect(store.load(flowId)).toBeNull());
        } else {
          await vi.waitFor(() => expect(released).toHaveBeenCalledOnce());
          expect(store.load(flowId)?.steps.find((step) => step.stepId === STEP_ID.deposit)?.outcome).toEqual({
            status: "submitted",
            hash,
          });
        }
        expect(releasedBeforeRead).toBe(0);
        await vi.waitFor(() => expect(released).toHaveBeenCalledOnce());
        expect(gateway.sendTransaction).not.toHaveBeenCalled();
      } finally {
        driver.dispose();
      }
    },
  );
});

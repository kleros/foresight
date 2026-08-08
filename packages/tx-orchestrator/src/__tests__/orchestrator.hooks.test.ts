import { describe, expect, it, vi } from "vitest";

import type { FlowHooks, TxStep } from "../types";
import {
  doneIds,
  errorOf,
  harness,
  persistedIds,
  reasonOf,
  settle,
  step,
  TX,
  type TestCtx,
  type TestSnapshot,
} from "./support/harness";

type AfterStepArgs = Parameters<NonNullable<FlowHooks<TestSnapshot, TestCtx>["afterStep"]>>[0];

/** Records what the adapter was handed, without fighting `vi.fn` generics. */
function recordingAfterStep() {
  const calls: AfterStepArgs[] = [];
  return { calls, afterStep: (args: AfterStepArgs) => void calls.push(args) };
}

/**
 * The domain adapter's half. It re-quotes, re-plans and reads receipts between
 * steps, all of which must finish *before* the next transaction is built, or
 * the run signs against numbers it has already decided are wrong.
 */
describe("afterStep", () => {
  it("is awaited before the next step is built, no signing against a stale re-quote", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const h = harness({
      hooks: { afterStep: ({ completed }) => (completed.stepId === "a" ? gate.then(() => undefined) : undefined) },
    });

    const running = h.start([step("a"), step("b")]);
    await settle();

    expect(h.gateway.signRequests).toHaveLength(1);

    release();
    await running;

    expect(h.gateway.signRequests).toHaveLength(2);
  });

  it("sees the receipt of the step that just landed", async () => {
    const recorder = recordingAfterStep();
    const h = harness({ hooks: { afterStep: recorder.afterStep } });

    await h.start([step("a")]);

    expect(recorder.calls[0]).toMatchObject({
      completed: { stepId: "a", outcome: { status: "confirmed" } },
      receipt: { status: "success", blockNumber: 19_000_000n },
    });
  });

  it("runs for a skipped step too, with no receipt to show for it", async () => {
    const recorder = recordingAfterStep();
    const h = harness({ hooks: { afterStep: recorder.afterStep } });

    await h.start([step("approve", { canSkip: () => true })]);

    expect(recorder.calls[0]).toMatchObject({
      completed: { stepId: "approve", outcome: { status: "skipped" } },
      receipt: null,
    });
  });

  it("can hand back a new context, the next step builds against it", async () => {
    const build = vi.fn<TxStep<TestSnapshot, TestCtx>["build"]>(() => TX);
    const h = harness({
      hooks: { afterStep: ({ ctx }) => ({ ctx: { ...ctx, nonce: ctx.nonce + 1 } }) },
    });

    await h.start([step("a"), step("b", { build })]);

    expect(build.mock.calls[0]?.[0]).toEqual({ chainId: 100, nonce: 2 });
  });

  it("can re-plan what is left after a quote moves within tolerance", async () => {
    const h = harness({
      hooks: {
        afterStep: ({ completed }) =>
          completed.stepId === "a" ? { pending: [step("b-requoted")], inform: "Slippage adjusted batch 2" } : undefined,
      },
    });

    await h.start([step("a"), step("b")]);

    expect(doneIds(h.orchestrator.getRun())).toEqual(["a", "b-requoted"]);
    expect(h.events).toContainEqual({ type: "inform", message: "Slippage adjusted batch 2" });
  });

  it("can stop the run when a quote moves beyond tolerance", async () => {
    const h = harness({
      hooks: { afterStep: ({ completed }) => (completed.stepId === "a" ? { pause: true } : undefined) },
    });

    await h.start([step("a"), step("b")]);

    expect(h.orchestrator.getStatus()).toBe("paused");
    expect(reasonOf(h.orchestrator.getRun())).toBe("adapter");
    expect(h.gateway.signRequests).toHaveLength(1);
    // The step that landed is still banked, a pause is not a rollback.
    expect(doneIds(h.orchestrator.getRun())).toEqual(["a"]);
  });

  it("stops the run when it throws, without losing the step that already landed", async () => {
    const h = harness({
      hooks: {
        afterStep: () => {
          throw new Error("could not read the deployed address");
        },
      },
    });

    await h.start([step("a"), step("b")]);

    expect(h.orchestrator.getStatus()).toBe("failed");
    expect(errorOf(h.orchestrator.getRun())?.message).toBe("After Step a: could not read the deployed address");
    expect(doneIds(h.orchestrator.getRun())).toEqual(["a"]);
    expect(h.gateway.signRequests).toHaveLength(1);
  });

  it("pauses rather than fails when what it threw was only a bad connection", async () => {
    // The transactions all landed; a re-quote could not reach its RPC. Failing
    // the run for that would send someone back to the start of a paid-for flow.
    const h = harness({
      hooks: {
        afterStep: () => {
          throw { name: "HttpRequestError", message: "fetch failed" };
        },
      },
    });

    await h.start([step("a"), step("b")]);

    expect(h.orchestrator.getStatus()).toBe("paused");
    expect(errorOf(h.orchestrator.getRun())?.cause).toBe("rpc");
    expect(h.types()).toContain("flow:paused");
    expect(h.types()).not.toContain("flow:failed");
  });

  it("stops the run when its re-plan names a step that already confirmed", async () => {
    const h = harness({
      hooks: {
        afterStep: ({ completed }) => (completed.stepId === "a" ? { pending: [step("a"), step("b")] } : undefined),
      },
    });

    // Left to itself this re-plans "a" forever, signing it every time round.
    await h.start([step("a"), step("b")]);

    expect(h.orchestrator.getStatus()).toBe("failed");
    expect(errorOf(h.orchestrator.getRun())?.message).toMatch(/already been confirmed/);
    expect(h.gateway.signRequests).toHaveLength(1);
  });

  it("persists the re-plan, so a reload resumes the steps the adapter actually chose", async () => {
    const h = harness({
      hooks: {
        afterStep: ({ completed }) =>
          completed.stepId === "a" ? { pending: [step("b-requoted")], pause: true } : undefined,
      },
    });

    await h.start([step("a"), step("b")]);

    expect(persistedIds(h.store.load("flow-1")).left).toEqual(["b-requoted"]);
  });
});

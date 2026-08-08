import type { RunState } from "./runState";
import { inFlightEntry } from "./steps";
import type { TransactionReceipt } from "viem";

import type { FlowError, OrchestratorEvent, ReconcileResult, StepSummary, TxGateway } from "./types";

/**
 * What actually happened to the transaction that was in flight when the tab
 * went away and the state to match.
 *
 * This is the only place that reads the chain outside the step loop, and it
 * runs before any wallet can open on resume.
 */
export async function reconcileInFlight<TSnapshot, TCtx>(args: {
  state: RunState<TSnapshot, TCtx>;
  gateway: TxGateway;
  emit: (event: OrchestratorEvent<TSnapshot, TCtx>) => void;
  /** Settling a step here has to mean what settling it in the loop means. */
  afterStep: (entry: StepSummary, receipt: TransactionReceipt) => Promise<void>;
}): Promise<ReconcileResult> {
  const { state, gateway, emit, afterStep } = args;
  const entry = inFlightEntry(state.get()?.steps ?? []);
  if (!entry) return { outcome: "none" };

  const { stepId, outcome } = entry;

  if (outcome.status === "awaiting-signature") {
    // No hash, so nothing to ask the chain. Only `canSkip` can answer this.
    state.setOutcome(stepId, { status: "pending" });
    state.persist();
    return { outcome: "unknown", stepId, canSelfCheck: Boolean(entry.step.canSkip) };
  }

  const { hash } = outcome;
  const receipt = await gateway.getReceipt(hash);

  if (receipt?.status === "reverted") {
    const error: FlowError = { stepId, message: "The transaction reverted on chain.", cause: "reverted", hash };
    state.setOutcome(stepId, { status: "pending" });
    state.transition({ status: "failed", error });
    state.persist();
    emit({ type: "flow:failed", error });
    return { outcome: "reverted", stepId, hash };
  }

  if (receipt) {
    // It mined while the tab was away; the step is done, not pending.
    state.setOutcome(stepId, {
      status: "confirmed",
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
    });
    state.persist();
    emit({ type: "step:confirmed", stepId, hash: receipt.transactionHash, receipt });

    await afterStep(
      { stepId, label: entry.label, outcome: { status: "confirmed", hash, blockNumber: receipt.blockNumber } },
      receipt,
    );
    return { outcome: "confirmed", stepId, hash };
  }

  if (await gateway.isKnown(hash)) {
    // Still in the mempool: resume adopts this hash instead of re-signing.
    return { outcome: "pending", stepId, hash };
  }

  state.setOutcome(stepId, { status: "pending" });
  state.persist();
  return { outcome: "dropped", stepId, hash };
}

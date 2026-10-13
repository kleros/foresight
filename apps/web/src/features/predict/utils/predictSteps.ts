import type { Address } from "viem";

import { shortenAddress } from "@/utils/address";
import { formatAmount } from "@/utils/amount";

import { STEP_ID } from "../flow/plan";
import type { PredictProgress } from "../run/types";

export type StepView = "idle" | "running" | "done" | "inactive";

export interface PredictStepRow {
  key: "wallet" | "funds" | "predict";
  title: string;
  subtitle: string;
  view: StepView;
}

export interface PredictSteps {
  rows: PredictStepRow[];
  /** Set once a run has stopped short, in words the visitor can act on. */
  failure?: string;
}

/** The chain's own errors name gas and contracts, which the popup never shows. */
const FAILURE_COPY: Record<NonNullable<PredictProgress["failure"]>["reason"], string> = {
  rejected: "You turned the request down.",
  cancelled: "Your wallet replaced the request with something else.",
  reverted: "The trade could not go through at these prices.",
  rpc: "The network did not answer in time.",
  unknown: "Something went wrong.",
  "no-route": "No trade moves these markets toward your estimates. Try a larger amount or a different estimate.",
  balance: "Your trade wallet balance is lower than shown. Check the amount and try again.",
  "deposit-unconfirmed": "Your last deposit may still be confirming. Check your wallet's activity, then try again.",
};

/** A transaction is out there and nothing has said how it ended, so it is neither a success nor a failure. */
const PENDING_COPY =
  "Your transaction was sent but has not confirmed yet. It may still go through. Press Predict to check again.";

const STAGE_COPY: Partial<Record<PredictProgress["stage"], string>> = {
  quoting: "Finding the best prices…",
  signing: "Waiting for your signature…",
  confirming: "Confirming…",
  complete: "Prediction successful!",
};

/**
 * The three rows of futarchy's predict timeline — trade wallet, funds, prediction — shown before
 * a run starts and filled in by the run's own steps once it does.
 */
export function predictSteps(args: {
  wallet: { address: Address; deployed: boolean } | null;
  /** Collateral the run adds, frozen when it starts so a refreshed balance does not rewrite it. */
  toAdd: bigint;
  symbol: string;
  decimals: number;
  progress: PredictProgress | null;
}): PredictSteps {
  const { wallet, toAdd, symbol, decimals, progress } = args;
  const runSteps = progress?.steps ?? [];
  const row = (id: string) => runSteps.find((step) => step.id === id);
  const halted = progress?.stage === "halted";

  const walletRow = row(STEP_ID.createExecutor);
  const walletReady = Boolean(wallet?.deployed) || walletRow?.state === "success";

  const fundsRow = row(STEP_ID.deposit);

  const batches = runSteps.filter((step) => step.id.startsWith("predict-"));
  const runningBatch = batches.findIndex((step) => step.state === "running");
  const predictRunning = runningBatch >= 0;
  const stageCopy = progress ? (STAGE_COPY[progress.stage] ?? "") : "";
  const adding = `Adding ${formatAmount(toAdd, decimals)} ${symbol}`;
  const fundsWait = progress?.stage === "signing" || progress?.stage === "confirming" ? stageCopy : "";

  const rows: PredictStepRow[] = [
    walletReady && wallet
      ? { key: "wallet", title: "Trade wallet", subtitle: shortenAddress(wallet.address), view: "done" }
      : {
          key: "wallet",
          title: "Create a trade wallet",
          subtitle: walletRow?.state === "running" ? stageCopy : "",
          view: walletRow?.state === "running" ? "running" : "idle",
        },
    {
      key: "funds",
      title: "Add funds to your trade wallet",
      subtitle: fundsRow?.state === "running" && fundsWait ? `${adding}. ${fundsWait}` : adding,
      view:
        fundsRow?.state === "running"
          ? "running"
          : fundsRow?.state === "success"
            ? "done"
            : halted || toAdd === 0n
              ? "inactive"
              : "idle",
    },
    {
      key: "predict",
      title: "Make prediction",
      subtitle: predictRunning
        ? batches.length > 1
          ? `Prediction ${runningBatch + 1} of ${batches.length}. ${stageCopy}`
          : stageCopy
        : progress?.stage === "complete"
          ? stageCopy
          : "",
      view: predictRunning ? "running" : progress?.stage === "complete" ? "done" : halted ? "inactive" : "idle",
    },
  ];

  if (!halted) return { rows };

  const partial =
    progress.batchesDone > 0 ? `${progress.batchesDone} of ${progress.batches} predictions went through. ` : "";
  const reason = progress.pendingHash
    ? PENDING_COPY
    : progress.failure
      ? FAILURE_COPY[progress.failure.reason]
      : FAILURE_COPY.unknown;
  return { rows, failure: `${partial}${reason}` };
}

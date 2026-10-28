import { Button } from "@kleros/ui-components-library";

import type { LiquidityRun } from "../hooks/useLiquidityRun";
import type { LiquidityFailureReason, LiquidityProgress } from "../types";

const STAGE_COPY: Partial<Record<LiquidityProgress["stage"], string>> = {
  signing: "Confirm in your wallet.",
  confirming: "Waiting for the transaction to confirm.",
  review: "An earlier liquidity run of this wallet is unfinished. Resume it to finish.",
  moved: "A pool moved since you reviewed it, so nothing more was signed.",
  complete: "Done. Your liquidity is updated.",
};

const FAILURE_COPY: Record<LiquidityFailureReason, string> = {
  rejected: "You declined in the wallet. Nothing more was signed.",
  cancelled: "The transaction was cancelled.",
  reverted: "A transaction reverted on chain.",
  rpc: "The network did not answer. Try again in a moment.",
  unknown: "Something went wrong.",
  unlisted: "A transaction did not match what was reviewed, so it was not sent.",
  closed: "The session has closed, so liquidity can't be added.",
  "wrong-wallet": "Connect the wallet that started this run.",
  "wrong-chain": "Switch the wallet to Gnosis.",
  pending: "The wallet has a transaction waiting. Wait for it to land first.",
  held: "A wallet prompt from before may still be open. Answer it, or wait before signing again.",
  storage: "This browser could not save the run, so nothing was sent.",
  "batch-unknown": "The wallet cannot say whether its batch landed, so it is not sent again.",
  "batch-failed": "The wallet's batch did not land.",
  "gas-reserve": "That would leave too little xDAI for gas.",
};

/** What the run is doing or why it stopped, with the actions that carry it on or let it go. */
export function LiquidityRunStatus({ run }: { run: LiquidityRun }) {
  const progress = run.progress;
  const text = progress?.failure ? FAILURE_COPY[progress.failure.reason] : progress && STAGE_COPY[progress.stage];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <p role="status" aria-live="polite" className="type-label text-fs-text-secondary min-w-0 flex-1 text-pretty">
          {text}
        </p>
        {progress?.stage === "review" ? <Button small text="Resume" onPress={run.resume} /> : null}
        {progress?.failure?.retryable ? <Button small text="Try again" onPress={run.retry} /> : null}
        {progress?.stage === "halted" || progress?.stage === "moved" ? (
          <Button small variant="secondary" text="Start over" onPress={run.reset} />
        ) : null}
      </div>
      {progress?.stage === "halted" || progress?.stage === "moved" ? (
        <p className="type-caption text-fs-text-secondary">
          Starting over keeps what this run already signed in your wallet; a new run splits again.
        </p>
      ) : null}
    </div>
  );
}

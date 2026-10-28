import { Button } from "@kleros/ui-components-library";

import type { LiquidityRun } from "../hooks/useLiquidityRun";
import { runStatus } from "../utils/runSteps";

/** What the run is doing or why it stopped, with the actions that carry it on or let it go. */
export function LiquidityRunStatus({ run }: { run: LiquidityRun }) {
  const progress = run.progress;
  const text = runStatus(progress)?.text;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <p role="status" aria-live="polite" className="type-label text-fs-text-secondary min-w-48 flex-1 text-pretty">
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

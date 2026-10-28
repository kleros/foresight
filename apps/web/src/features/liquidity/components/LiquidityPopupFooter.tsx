import clsx from "clsx";

import { PopupButton } from "@/components/ui/PopupButton";

import type { LiquidityRun } from "../hooks/useLiquidityRun";
import { busyText } from "../utils/runSteps";

/**
 * A liquidity popup's sticky footer: while the run is this popup's (`isOwn`), the action that carries it on,
 * else `idle`; Start over sits beside Try again as the quiet action.
 */
export function LiquidityPopupFooter({
  run,
  isOwn,
  idle,
}: {
  run: LiquidityRun;
  isOwn: boolean;
  idle: { text: string; isDisabled: boolean; onPress: () => void; describedBy?: string };
}) {
  const progress = run.progress;
  const stage = progress?.stage;
  const stopped = stage === "halted" || stage === "moved";
  const startOver =
    isOwn && progress?.failure?.retryable ? (
      <div className="fs-enter w-28 shrink-0 [@media(max-width:374px)]:w-full">
        <PopupButton text="Start over" quiet isDisabled={false} onPress={run.reset} />
      </div>
    ) : null;
  const primary = !isOwn ? (
    <PopupButton
      text={idle.text}
      isDisabled={idle.isDisabled}
      onPress={idle.onPress}
      aria-describedby={idle.describedBy}
    />
  ) : run.isRunning ? (
    <PopupButton text={idle.text} busyText={busyText(progress)} isDisabled onPress={idle.onPress} />
  ) : stage === "review" ? (
    <PopupButton text="Resume" isDisabled={false} onPress={run.resume} />
  ) : progress?.failure?.retryable ? (
    <PopupButton text="Try again" isDisabled={false} onPress={run.retry} />
  ) : stopped ? (
    <PopupButton text="Start over" isDisabled={false} onPress={run.reset} />
  ) : (
    <PopupButton
      text={idle.text}
      isDisabled={idle.isDisabled}
      onPress={idle.onPress}
      aria-describedby={idle.describedBy}
    />
  );

  return (
    // under 375px Start over and Try again outgrow one row, so they stack in their focus order
    <div
      className={clsx(
        "predict-footer bg-fs-surface landscape-phone:pb-2 sticky bottom-0 flex gap-2 pt-2 pb-4 short:pb-3",
        "[@media(max-width:374px)]:flex-col",
      )}
    >
      {startOver}
      {primary}
    </div>
  );
}

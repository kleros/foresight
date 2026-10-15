import clsx from "clsx";

import CheckOutline from "@/assets/svg/check-outline.svg";
import CircleOutline from "@/assets/svg/circle-outline.svg";
import CloseCircle from "@/assets/svg/close-circle.svg";

import type { StepView } from "../utils/predictSteps";

const TONE: Record<StepView, string> = {
  idle: "text-fs-text-secondary",
  inactive: "text-fs-text-secondary",
  running: "text-fs-accent",
  done: "text-fs-tone-success",
  failed: "text-fs-tone-error",
};

/** futarchy-ui's circle, check and cross stacked in one 24px bullet; `view` picks the one shown, so a change cross-fades. */
export function SpineBullet({ view }: { view: StepView }) {
  return (
    <span data-bullet={view} className={clsx("spine-bullet relative block size-6 shrink-0", TONE[view])} aria-hidden>
      <CircleOutline data-glyph="circle" />
      <CheckOutline data-glyph="check" />
      <CloseCircle data-glyph="cross" />
    </span>
  );
}

import { useEffect, useRef } from "react";

import { CustomTimeline } from "@kleros/ui-components-library";
import clsx from "clsx";

import CheckOutline from "@/assets/svg/check-outline.svg";
import CircleOutline from "@/assets/svg/circle-outline.svg";
import CloseCircle from "@/assets/svg/close-circle.svg";

import type { PredictSteps, StepView } from "../utils/predictSteps";

type TimelineItem = React.ComponentProps<typeof CustomTimeline>["items"][number];

const BULLET: Record<StepView, { Icon: React.FC<React.SVGAttributes<SVGElement>>; className: string }> = {
  idle: { Icon: CircleOutline, className: "text-fs-text-secondary" },
  running: { Icon: CircleOutline, className: "text-fs-accent" },
  done: { Icon: CheckOutline, className: "text-fs-tone-success" },
  inactive: { Icon: CircleOutline, className: "text-fs-text-secondary" },
  failed: { Icon: CloseCircle, className: "text-fs-tone-error" },
};

/** futarchy-ui's bullets, defined once per view: a component built per render is a new type on every pass. */
const BULLETS = Object.fromEntries(
  Object.entries(BULLET).map(([view, { Icon, className }]) => [
    view,
    () => <Icon data-bullet={view} className={clsx("size-6 shrink-0", className)} aria-hidden />,
  ]),
) as Record<StepView, () => React.ReactNode>;

/** Dimmed only when it will not run; a finished step stays at full strength, as futarchy-ui keeps it. */
const TIMELINE_STATE: Record<StepView, TimelineItem["state"]> = {
  idle: undefined,
  running: "loading",
  done: undefined,
  inactive: "disabled",
  failed: undefined,
};

export function PredictStepsTimeline({ steps }: { steps: PredictSteps }) {
  const timeline = useRef<HTMLDivElement>(null);
  const running = steps.rows.find((row) => row.view === "running")?.key;
  // the timeline sits below the amount, often past the fold of the popup's scroll area
  useEffect(() => {
    if (steps.failure === undefined && running === undefined) return;
    // a behaviour passed here overrides the stylesheet's reduced-motion scroll-behavior
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    timeline.current?.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [steps.failure, running]);

  const items: TimelineItem[] = steps.rows.map((row) => ({
    title: row.title,
    party: "",
    subtitle: row.subtitle,
    Icon: BULLETS[row.view],
    state: TIMELINE_STATE[row.view],
  }));

  const [first, ...rest] = items;
  if (!first) return null;

  return (
    // a fixed column, so a longer subtitle in one state does not re-centre the rows
    <div ref={timeline} className="mx-auto mt-4 w-full max-w-75 short:mt-2">
      <CustomTimeline
        items={[first, ...rest]}
        className={clsx(
          "w-full [&_small]:truncate",
          // the library pulses the whole row; only the bullet pulses, so the subtitle stays legible
          "[&_li]:animate-none [&_[data-bullet=running]]:animate-loading motion-reduce:[&_[data-bullet=running]]:animate-none",
          // every row keeps its subtitle line, empty or not, so a state change never moves the rows
          "[&_li>div:nth-child(1)]:min-h-11 [&_small]:min-h-4 [&_small]:text-fs-text-secondary",
          "[&_li>div:nth-child(2)]:ml-2 [&_li>div:nth-child(2)]:pt-0.5",
          "[&_li>div:nth-child(1)>div]:border-l-fs-accent [&_li>div:nth-child(1)>div]:my-2",
          // 36px rows where the window is short
          "short:[&_li>div:nth-child(1)]:min-h-9 short:[&_li>div:nth-child(2)]:mb-0 short:[&_li>div:nth-child(1)>div]:my-1",
        )}
      />
    </div>
  );
}

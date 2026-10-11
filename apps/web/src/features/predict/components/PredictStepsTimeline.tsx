import { CustomTimeline } from "@kleros/ui-components-library";
import clsx from "clsx";

import { ForesightIcon, type ForesightIconName } from "@/components/ui/ForesightIcon";
import Loader from "@/components/ui/Loader";

import type { PredictSteps, StepView } from "../utils/predictSteps";

type TimelineItem = React.ComponentProps<typeof CustomTimeline>["items"][number];

const BULLET: Record<StepView | "failed", { icon: ForesightIconName; className: string }> = {
  idle: { icon: "empty", className: "text-fs-text-secondary" },
  running: { icon: "empty", className: "text-fs-accent" },
  done: { icon: "check", className: "text-fs-tone-success" },
  inactive: { icon: "empty", className: "text-fs-text-secondary" },
  failed: { icon: "cross", className: "text-fs-tone-error" },
};

/** Defined once per view: a component built per render is a new type on every pass. */
const BULLETS = Object.fromEntries(
  Object.entries(BULLET).map(([view, { icon, className }]) => [
    view,
    () => <ForesightIcon name={icon} size={16} className={className} style={{ flex: "none" }} />,
  ]),
) as Record<StepView | "failed", () => React.ReactNode>;

const TIMELINE_STATE: Record<StepView, TimelineItem["state"]> = {
  idle: undefined,
  running: "loading",
  done: "disabled",
  inactive: "disabled",
};

export function PredictStepsTimeline({ steps }: { steps: PredictSteps }) {
  const items: TimelineItem[] = steps.rows.map((row) => ({
    title: row.title,
    party: row.view === "running" ? <Loader className="mb-1 size-4" /> : "",
    subtitle: row.subtitle,
    Icon: BULLETS[row.view],
    state: TIMELINE_STATE[row.view],
  }));

  if (steps.failure !== undefined) {
    items.push({
      title: "Prediction failed!",
      party: "",
      subtitle: steps.failure,
      variant: "refused",
      Icon: BULLETS.failed,
    });
  }

  const [first, ...rest] = items;
  if (!first) return null;

  return (
    <div className="mt-5 flex flex-col items-center" role="status" aria-live="polite">
      <CustomTimeline
        items={[first, ...rest]}
        className={clsx(
          "[&_li>div:nth-child(1)]:min-h-14",
          "[&_li>div:nth-child(2)]:ml-2 [&_li>div:nth-child(2)]:pt-0.5",
          "[&_li>div:nth-child(1)>div]:border-l-fs-accent [&_li>div:nth-child(1)>div]:my-2",
        )}
      />
    </div>
  );
}

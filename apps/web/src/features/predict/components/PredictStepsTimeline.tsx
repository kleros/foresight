import { createContext, useContext, useEffect, useRef } from "react";

import { CustomTimeline } from "@kleros/ui-components-library";
import clsx from "clsx";

import { SpineBullet } from "./SpineBullet";
import type { PredictStepRow, PredictSteps, StepView } from "../utils/predictSteps";

type TimelineItem = React.ComponentProps<typeof CustomTimeline>["items"][number];

const Views = createContext<Partial<Record<PredictStepRow["key"], StepView>>>({});

/**
 * The library calls `Icon` with no props, so each row's bullet reads its view from context. One component
 * per row, defined once: the same type across views keeps the element, so its glyphs can cross-fade.
 */
function WalletBullet() {
  return <SpineBullet view={useContext(Views).wallet ?? "idle"} />;
}
function FundsBullet() {
  return <SpineBullet view={useContext(Views).funds ?? "idle"} />;
}
function PredictBullet() {
  return <SpineBullet view={useContext(Views).predict ?? "idle"} />;
}
const BULLETS: Record<PredictStepRow["key"], () => React.ReactNode> = {
  wallet: WalletBullet,
  funds: FundsBullet,
  predict: PredictBullet,
};

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
  // the timeline sits below the amount, past the fold of the popup's scroll area on a short window
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
    Icon: BULLETS[row.key],
    state: TIMELINE_STATE[row.view],
  }));
  const views = Object.fromEntries(steps.rows.map((row) => [row.key, row.view]));

  const [first, ...rest] = items;
  if (!first) return null;

  return (
    <div ref={timeline} className="w-full">
      <Views.Provider value={views}>
        <CustomTimeline
          items={[first, ...rest]}
          className={clsx(
            "predict-spine w-full",
            // the library pulses the whole row; only the bullet pulses, so the subtitle stays legible
            "[&_li]:animate-none [&_[data-bullet=running]]:animate-loading motion-reduce:[&_[data-bullet=running]]:animate-none",
          )}
        />
      </Views.Provider>
    </div>
  );
}

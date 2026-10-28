import { createContext, useContext, useEffect, useRef } from "react";

import { CustomTimeline } from "@kleros/ui-components-library";
import clsx from "clsx";

import { StepBullet, type StepView } from "./StepBullet";

type TimelineItem = React.ComponentProps<typeof CustomTimeline>["items"][number];

export interface TimelineStep {
  key: string;
  title: string;
  /** Said on the title's line, right-aligned. */
  subtitle: string;
  view: StepView;
}

const Views = createContext<readonly StepView[]>([]);

/** What the bullet's glyph shows, for a screen reader; the glyph itself is hidden from one. */
const VIEW_TEXT: Record<StepView, string> = {
  idle: "to do",
  running: "to do",
  inactive: "to do",
  done: "done",
  failed: "stopped here",
};

/**
 * The library calls `Icon` with no props, so each bullet reads its row's view from context. One component per
 * position, made once: the same type across views keeps the element, so its glyphs can cross-fade.
 */
const bullets: (() => React.ReactNode)[] = [];
function bulletAt(index: number): () => React.ReactNode {
  bullets[index] ??= function Bullet() {
    const view = useContext(Views)[index] ?? "idle";
    return (
      <>
        <StepBullet number={index + 1} view={view} />
        <span className="sr-only">{VIEW_TEXT[view]}</span>
      </>
    );
  };
  return bullets[index];
}

/**
 * Dimmed only when it will not run, by the stylesheet's quieter text tokens: the library's disabled state is
 * opacity 0.5, under 4.5:1. A finished step stays at full strength, as futarchy-ui keeps it.
 */
const TIMELINE_STATE: Record<StepView, TimelineItem["state"]> = {
  idle: undefined,
  running: "loading",
  done: undefined,
  inactive: undefined,
  failed: undefined,
};

/** Parts joined by " + " are kept whole, so a wrapped line breaks only after a "+". */
function keepPartsWhole(text: string): string {
  return text.includes(" + ")
    ? text
        .split(" + ")
        .map((part) => part.replaceAll(" ", "\u00a0"))
        .join("\u00a0+ ")
    : text;
}

/** A popup's numbered steps in the house timeline; it scrolls itself into view as a step runs or the run stops. */
export function StepsTimeline({
  rows,
  stopped,
  className,
}: {
  rows: readonly TimelineStep[];
  /** The run stopped short. */
  stopped: boolean;
  className?: string;
}) {
  const timeline = useRef<HTMLDivElement>(null);
  const running = rows.find((row) => row.view === "running")?.key;
  // the timeline sits below the form, past the fold of the popup's scroll area on a short window
  useEffect(() => {
    if (!stopped && running === undefined) return;
    // a behaviour passed here overrides the stylesheet's reduced-motion scroll-behavior
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // a frame later, once the scroll area's own effect has raised its cue strip and shortened the view
    const frame = requestAnimationFrame(() =>
      timeline.current?.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [stopped, running]);

  const items: TimelineItem[] = rows.map((row, index) => ({
    title: row.title,
    party: keepPartsWhole(row.subtitle),
    subtitle: "",
    Icon: bulletAt(index),
    state: TIMELINE_STATE[row.view],
  }));
  const views = rows.map((row) => row.view);

  const [first, ...rest] = items;
  if (!first) return null;

  return (
    // on a phone on its side the popup's status slot scrolls with the steps, so it lands in view too
    <div ref={timeline} className="@container landscape-phone:scroll-mb-12 short:landscape-phone:scroll-mb-11 w-full">
      <Views.Provider value={views}>
        <CustomTimeline
          items={[first, ...rest]}
          className={clsx(
            "fs-steps w-full",
            // the library pulses the whole row; only the bullet pulses, so its detail stays legible
            "[&_li]:animate-none [&_[data-bullet=running]]:animate-loading motion-reduce:[&_[data-bullet=running]]:animate-none",
            className,
          )}
        />
      </Views.Provider>
    </div>
  );
}

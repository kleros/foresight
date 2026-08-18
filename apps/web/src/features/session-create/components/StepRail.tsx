import { useState } from "react";

import clsx from "clsx";

/** One state, not two flags: an entry cannot be both unresolved and merely worth a look. */
export type RailState = "ok" | "warn" | "error";

export type RailEntry = {
  key: string;
  num: string;
  label: string;
  elementId: string;
  sub?: boolean;
  state: RailState;
};

export const railState = (ok: boolean, warned: boolean): RailState => (!ok ? "error" : warned ? "warn" : "ok");

/** The step a sub-entry belongs to, so picking a branch lights its heading too. */
function stepIndexOf(entries: RailEntry[], index: number): number {
  for (let i = index; i >= 0; i--) if (!entries[i]?.sub) return i;
  return index;
}

const DOT: Record<RailState, string> = {
  ok: "bg-fs-status-registered opacity-55",
  warn: "bg-fs-status-pending",
  error: "bg-fs-status-disputed",
};

export function StepRail({
  entries,
  index,
  onGoTo,
  onReset,
  issueCount,
  warningCount,
}: {
  entries: RailEntry[];
  index: number;
  onGoTo: (index: number, elementId: string) => void;
  onReset: () => void;
  issueCount: number;
  warningCount: number;
}) {
  const summary: RailState = issueCount > 0 ? "error" : warningCount > 0 ? "warn" : "ok";
  const stepIndex = stepIndexOf(entries, index);
  // Armed first: the draft is the only copy of everything typed so far.
  const [arming, setArming] = useState(false);
  return (
    <div className="fs-rail">
      <div className="type-caption text-fs-text-secondary pb-3 tracking-[0.04em] uppercase">New session</div>
      {/* The rest of the rail is the label, the reset row and the summary. */}
      <div className="border-fs-border relative h-[calc(100%-124px)] overflow-y-auto border-t pt-3">
        <div className="flex flex-col gap-0.75">
          {entries.map((entry, i) => {
            // Smoothstep, so the entries either side of the active one ease off
            // instead of stepping. Everything further away sits at zero.
            const distance = i === stepIndex ? 0 : Math.abs(i - index);
            const nearness = 1 - Math.min(1, distance);
            const weight = nearness * nearness * (3 - 2 * nearness);
            return (
              <button
                key={entry.key}
                type="button"
                onClick={() => onGoTo(i, entry.elementId)}
                className={clsx(
                  "rounded-fs relative flex w-full cursor-pointer items-center gap-2.5 border-none bg-transparent py-0.5 text-left transition-[font-size,opacity,color]",
                  entry.sub ? "pr-2.5 pl-6.5" : "px-2.5",
                  weight > 0.5 ? "text-fs-text-primary font-semibold" : "text-fs-text-secondary font-normal",
                )}
                style={{
                  minHeight: entry.sub ? 23 + 6 * weight : 27 + 21 * weight,
                  fontSize: `${entry.sub ? 12.5 + 2 * weight : 14 + 7 * weight}px`,
                  lineHeight: `${entry.sub ? 18 : 26}px`,
                  opacity: 0.42 + 0.58 * weight,
                  transitionDuration: "var(--fs-dur-structural)",
                  transitionTimingFunction: "var(--fs-ease-structural)",
                }}
              >
                <span className="type-caption text-fs-text-secondary w-4 flex-none text-left tabular-nums">
                  {entry.num}
                </span>
                <span className="flex-1 text-left text-pretty">{entry.label}</span>
                <span className={clsx("h-1.5 w-1.5 flex-none rounded-xs", DOT[entry.state])} aria-hidden />
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-3 pb-3">
        {arming ? (
          <>
            <button
              type="button"
              onClick={() => {
                setArming(false);
                onReset();
              }}
              className="type-caption text-fs-status-disputed cursor-pointer border-none bg-transparent p-0"
            >
              Clear everything
            </button>
            <button
              type="button"
              onClick={() => setArming(false)}
              className="type-caption text-fs-text-secondary cursor-pointer border-none bg-transparent p-0"
            >
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setArming(true)}
            className="type-caption text-fs-text-secondary hover:text-fs-text-primary cursor-pointer border-none bg-transparent p-0"
          >
            Reset draft
          </button>
        )}
      </div>
      <div className="border-fs-border type-caption text-fs-text-secondary border-t pt-4 text-pretty">
        <div className="flex items-center gap-2 pb-1.5">
          <span className={clsx("h-2 w-2 flex-none rounded-xs", DOT[summary], "opacity-100")} aria-hidden />
          <span>
            {issueCount > 0
              ? `${issueCount} unresolved`
              : warningCount > 0
                ? `Every step resolves, ${warningCount} to check`
                : "Every step resolves"}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Compact step chips shown above the form on narrow viewports. */
export function StepRailMobile({
  entries,
  index,
  onGoTo,
}: {
  entries: RailEntry[];
  index: number;
  onGoTo: (index: number, elementId: string) => void;
}) {
  const top = entries.filter((e) => !e.sub);
  const active = entries[index];
  const activeStep = entries[stepIndexOf(entries, index)];
  return (
    <div className="fs-railh">
      <div className="flex items-center gap-2 overflow-auto">
        {top.map((entry) => {
          const entryIndex = entries.indexOf(entry);
          const isActive = activeStep?.elementId === entry.elementId;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => onGoTo(entryIndex, entry.elementId)}
              className={clsx(
                "fs-echo rounded-fs inline-flex h-7.5 w-8.5 flex-none cursor-pointer items-center justify-center border text-sm tabular-nums",
                isActive
                  ? "bg-fs-surface-tint border-fs-border-accent text-fs-text-primary font-semibold"
                  : "border-fs-border bg-transparent",
                entry.state !== "error" || isActive ? "text-fs-text-primary" : "text-fs-text-secondary",
              )}
            >
              {entry.num}
            </button>
          );
        })}
      </div>
      <div className="flex items-baseline gap-2 pt-2">
        <span className="text-fs-text-primary text-sm font-semibold">
          {active?.sub ? "Branch markets" : (active?.label ?? "")}
        </span>
        <span className="type-caption text-fs-text-secondary">{active?.sub ? active.label : ""}</span>
      </div>
    </div>
  );
}

import { Tooltip } from "@kleros/ui-components-library";
import clsx from "clsx";

import { ForesightIcon } from "@/components/ui/ForesightIcon";

export const hintTooltipClass = "max-w-64 px-3.5 py-2.5 [&_small]:type-caption";

/** Info glyph with a tooltip, used beside field labels. */
export function InfoTip({ text, place = "right" }: { text: string; place?: "left" | "right" | "top" | "bottom" }) {
  return (
    <Tooltip text={text} place={place} className={hintTooltipClass}>
      <span tabIndex={0} className="text-fs-text-secondary inline-flex cursor-help">
        <ForesightIcon name="info-circle" size={14} />
      </span>
    </Tooltip>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 pb-1">{children}</div>;
}

/** Small bordered chip used on review rows and summaries. */
export function Chip({
  children,
  strong,
  className,
}: {
  children: React.ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "rounded-fs bg-fs-surface-sunken type-caption inline-flex h-6 items-center border px-2.5 whitespace-nowrap",
        strong ? "border-fs-border-strong text-fs-text-primary" : "border-fs-border text-fs-text-secondary",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Toggle row for each section's advanced settings. */
export function AdvancedToggle({
  open,
  onToggle,
  label,
  summary,
  summaryTone = "muted",
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  summary?: string;
  summaryTone?: "muted" | "warning" | "error";
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="text-fs-text-primary flex cursor-pointer items-center gap-2.5 border-none bg-transparent p-0"
    >
      <ForesightIcon
        name="chevron"
        size={18}
        state={open ? "expanded" : undefined}
        className="text-fs-text-secondary"
      />
      <span className="text-sm font-semibold">{label}</span>
      {summary ? (
        <span
          className={clsx(
            "type-caption",
            summaryTone === "muted" && "text-fs-text-secondary",
            summaryTone === "warning" && "text-fs-status-pending",
            summaryTone === "error" && "text-fs-status-disputed",
          )}
        >
          {summary}
        </span>
      ) : null}
    </button>
  );
}

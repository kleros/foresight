import { lazy, Suspense, useState, type ReactNode } from "react";

import { TextArea, Tooltip } from "@kleros/ui-components-library";

import EyeIcon from "@/assets/svg/eye-outline.svg";
import PencilIcon from "@/assets/svg/pencil.svg";

import { unescapeNewlines } from "@/utils/markdown";

const Markdown = lazy(() => import("@/components/ui/Markdown").then((m) => ({ default: m.Markdown })));

/** A markdown textarea with a preview it can flip to, on the toggle top right. */
export function MarkdownField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  header,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  header?: ReactNode;
}) {
  const [previewing, setPreviewing] = useState(false);
  const action = previewing ? "Edit" : "Preview";
  const ActionIcon = previewing ? PencilIcon : EyeIcon;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">{header}</div>
        <Tooltip text={action} place="top" className="px-2.5 py-1 [&_small]:type-caption">
          <button
            type="button"
            onClick={() => setPreviewing((v) => !v)}
            aria-label={`${action} ${ariaLabel}`}
            className="fs-echo rounded-fs border-fs-border bg-fs-surface-sunken text-fs-text-secondary flex h-6 w-6 flex-none cursor-pointer items-center justify-center border dark:opacity-70"
          >
            <ActionIcon width={12} height={12} />
          </button>
        </Tooltip>
      </div>
      {previewing ? (
        <div className="rounded-fs border-fs-border bg-fs-surface-sunken min-h-24 border px-3.5 py-2.5">
          {value.trim() ? (
            <Suspense fallback={<span className="type-caption text-fs-text-secondary">Loading the preview...</span>}>
              <Markdown>{value}</Markdown>
            </Suspense>
          ) : (
            <span className="type-caption text-fs-text-secondary">Nothing to preview yet.</span>
          )}
        </div>
      ) : (
        <TextArea
          className="w-full"
          inputProps={{ className: "w-full text-sm" }}
          resizeY
          value={value}
          onChange={(v) => onChange(unescapeNewlines(v))}
          placeholder={placeholder}
          aria-label={ariaLabel}
        />
      )}
    </div>
  );
}

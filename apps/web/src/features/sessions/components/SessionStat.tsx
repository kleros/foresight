import type { ComponentType, ReactNode, Ref, SVGProps } from "react";

import clsx from "clsx";

/** A header figure; with `onOpen` the whole stat is a button that opens its breakdown. */
export function SessionStat({
  Icon,
  label,
  pending,
  onOpen,
  buttonRef,
  expanded,
  children,
}: {
  Icon: ComponentType<SVGProps<SVGElement>>;
  label: string;
  pending?: boolean;
  onOpen?: () => void;
  /** Holds the button while the stat is one; a pending stat renders none. */
  buttonRef?: Ref<HTMLButtonElement>;
  /** Whether the breakdown it opens is showing. */
  expanded?: boolean;
  children: ReactNode;
}) {
  const opens = onOpen !== undefined && !pending;
  const content = (
    <>
      <Icon className="text-fs-accent size-4 shrink-0 [&_path]:fill-current" />
      <span className="text-fs-text-secondary shrink-0 text-sm">{label}:</span>
      {pending ? (
        <span className="fs-skeleton inline-block h-4 w-12" />
      ) : (
        <span
          className={clsx(
            "text-fs-text-primary text-sm font-semibold tabular-nums",
            opens && "underline decoration-dotted underline-offset-4",
          )}
        >
          {children}
        </span>
      )}
    </>
  );

  return opens ? (
    <button
      ref={buttonRef}
      type="button"
      aria-haspopup="dialog"
      aria-expanded={expanded ?? false}
      onClick={onOpen}
      className="flex cursor-pointer flex-wrap items-center gap-2 text-left"
    >
      {content}
    </button>
  ) : (
    <div className="flex flex-wrap items-center gap-2">{content}</div>
  );
}

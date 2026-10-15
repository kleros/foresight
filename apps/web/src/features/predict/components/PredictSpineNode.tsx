import type { ReactNode } from "react";

import { SpineBullet } from "./SpineBullet";

/**
 * One of the popup's input nodes, on the same 24px bullet column and 2px line as the run steps below it.
 * Done once the run locks what it holds.
 */
export function PredictSpineNode({
  title,
  right,
  done,
  delayed = false,
  children,
}: {
  title: ReactNode;
  right?: ReactNode;
  done: boolean;
  /** Checks one echo after the node above, so the two read as a sequence. */
  delayed?: boolean;
  children: ReactNode;
}) {
  return (
    <div data-spine-node data-delayed={delayed || undefined} className="spine-node flex w-full">
      <div className="flex w-6 flex-none flex-col items-center">
        <SpineBullet view={done ? "done" : "idle"} />
        <div className="spine-line" />
      </div>
      <div className="ml-2 min-w-0 flex-1 pt-0.5">
        <div className="flex min-h-5 items-baseline justify-between gap-3">
          <h3 className="text-fs-text-primary min-w-0 truncate text-sm leading-5 font-semibold">{title}</h3>
          {right}
        </div>
        <div className="mt-1.5 pb-2 sm:pb-2.5">{children}</div>
      </div>
    </div>
  );
}

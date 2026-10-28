import { forwardRef } from "react";

import clsx from "clsx";

import { StatusGlyph, type PopupStatusLine } from "./StatusGlyph";

/** A popup's one status slot: held at its height whether it says anything or not, so nothing under it moves. */
export const StatusCallout = forwardRef<HTMLParagraphElement, { status: PopupStatusLine | null; id?: string }>(
  function StatusCallout({ status, id }, ref) {
    return (
      <p
        ref={ref}
        id={id}
        role="status"
        aria-live="polite"
        data-tone={status?.tone}
        className="predict-status text-left"
      >
        {status ? (
          <span
            key={status.text}
            data-testid="status-box"
            data-small={status.small}
            className={clsx("predict-status-box", status.tone !== "neutral" && "fs-enter")}
          >
            <StatusGlyph status={status} />
            <span data-testid="status-text">{status.text}</span>
          </span>
        ) : null}
      </p>
    );
  },
);

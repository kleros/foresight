/** A popup's status line: what it says, in which tone. */
export interface PopupStatusLine {
  text: string;
  tone: "neutral" | "warning" | "error";
  /** Said for the visitor's information only, in the popup's small type on one line. */
  small?: true;
  /** A run is checking something before it goes on. */
  waiting?: true;
}

/** The status callout's 16px mark: its tone, or a clock while a run checks something. */
export function StatusGlyph({
  status,
  className,
}: {
  status: Pick<PopupStatusLine, "tone" | "waiting">;
  className?: string;
}) {
  const kind = status.waiting ? "waiting" : status.tone;
  return (
    <svg
      data-testid="status-glyph"
      data-glyph={kind}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {kind === "warning" ? (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M12 7.5v6M12 15.5v1.5" />
        </>
      ) : kind === "error" ? (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" />
        </>
      ) : kind === "waiting" ? (
        <path d="M12 3a9 9 0 1 1-6.36 2.64M12 7.5V12l3.5 2" />
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6M12 7.5v1.5" />
        </>
      )}
    </svg>
  );
}

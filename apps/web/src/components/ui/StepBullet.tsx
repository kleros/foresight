/** A step row's state; `inactive` will not run, `failed` is where the run stopped. */
export type StepView = "idle" | "running" | "done" | "inactive" | "failed";

/** A numbered 24px bullet: the digit, a check and a cross stacked, so a change of `view` cross-fades. */
export function StepBullet({ view, number }: { view: StepView; number: number }) {
  return (
    <span data-bullet={view} className="step-bullet" aria-hidden>
      <span data-glyph="digit">{number}</span>
      <svg data-glyph="check" viewBox="0 0 16 16" fill="none">
        <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <svg data-glyph="cross" viewBox="0 0 16 16" fill="none">
        <path d="M4.5 4.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

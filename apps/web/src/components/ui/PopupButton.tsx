import { Button } from "@kleros/ui-components-library";

/**
 * The popup's one wide button. Busy, it keeps a label beside a spinner, which the library's
 * `isLoading` would hide behind its symbol. Quiet, it steps back to the panel's tone for a secondary action.
 */
export function PopupButton({
  text,
  busyText,
  quiet = false,
  isDisabled,
  onPress,
  "aria-describedby": describedBy,
}: {
  text: string;
  quiet?: boolean;
  /** Said while a run goes; the button cannot be pressed meanwhile. */
  busyText?: string;
  isDisabled: boolean;
  onPress: () => void;
  "aria-describedby"?: string;
}) {
  const busy = busyText !== undefined;
  return (
    <Button
      className="predict-cta"
      data-busy={busy || undefined}
      data-quiet={quiet || undefined}
      text={busy ? busyText : text}
      icon={busy ? <span data-testid="predict-spinner" className="predict-spinner" aria-hidden /> : undefined}
      isDisabled={busy || isDisabled}
      onPress={onPress}
      aria-describedby={describedBy}
    />
  );
}

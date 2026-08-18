import { DropdownSelect } from "@kleros/ui-components-library";
import clsx from "clsx";

export type SelectOption = { id: string; text: string };

/**
 * Wrapper over the library's `DropdownSelect` so the app depends on our
 * interface, not theirs.
 *
 * Why the cast: the library declares `SelectProps extends AriaSelectProps`
 * without type arguments, but react-aria-components v1.19 made
 * `SelectProps<T, M>` require them. The bare reference degrades, so the
 * published type loses `selectedKey` and `className` even though the
 * implementation destructures and uses both. Contained here rather than
 * repeated at every call site; delete once the library types are fixed.
 */
export function Select({
  label,
  hideLabel,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  /** Keeps the label as the accessible name where the field is titled beside it. */
  hideLabel?: boolean;
  options: SelectOption[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const Untyped = DropdownSelect as unknown as React.FC<{
    label: string;
    items: SelectOption[];
    selectedKey: string;
    callback: (item: SelectOption) => void;
    className?: string;
  }>;
  return (
    <Untyped
      label={label}
      items={options}
      selectedKey={value}
      callback={(item) => onChange(item.id)}
      className={clsx(hideLabel && "*:first:sr-only", className)}
    />
  );
}

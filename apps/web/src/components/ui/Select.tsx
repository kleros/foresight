import { DropdownSelect } from "@kleros/ui-components-library";
import clsx from "clsx";

export type SelectOption = { id: string; text: string; icon?: React.ReactNode };

/** Wrapper over the library's `DropdownSelect` so the app depends on our interface, not theirs. */
export function Select({
  label,
  hideLabel,
  options,
  value,
  onChange,
  placeholder,
  isDisabled,
  className,
}: {
  label: string;
  /** Keeps the label as the accessible name where the field is titled beside it. */
  hideLabel?: boolean;
  options: SelectOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  isDisabled?: boolean;
  className?: string;
}) {
  return (
    <DropdownSelect
      label={label}
      items={options}
      selectedKey={value}
      callback={(item) => onChange(String(item.id))}
      placeholder={placeholder}
      isDisabled={isDisabled}
      className={clsx(hideLabel && "*:first:sr-only", className)}
    />
  );
}

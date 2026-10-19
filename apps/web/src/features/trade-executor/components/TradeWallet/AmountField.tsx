import { BigNumberField } from "@kleros/ui-components-library";
import clsx from "clsx";
import { formatUnits } from "viem";

import LightButton from "@/components/ui/LightButton";

import { cutToOwned, ownedAmount } from "@/utils/amount";

export function AmountField({
  value,
  onChange,
  available,
  decimals,
  symbol,
  availableLabel = "Balance",
  error,
  isLoadingBalance,
  isReadOnly,
  maxIsExact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  available: bigint | undefined;
  decimals: number;
  /** Left out for an amount that is not of one token. */
  symbol?: string;
  availableLabel?: string;
  error?: string;
  isLoadingBalance?: boolean;
  isReadOnly?: boolean;
  /** Max takes the whole balance rather than the shown amount. */
  maxIsExact?: boolean;
}) {
  const max = available === undefined ? undefined : maxIsExact ? available : cutToOwned(available, decimals);
  const availableText = isLoadingBalance
    ? "Reading balance…"
    : // a balance we could not read must not read as an empty one
      available === undefined
      ? "Could not read balance"
      : `${availableLabel}: ${ownedAmount(available, decimals)}${symbol ? ` ${symbol}` : ""}`;

  return (
    <div className="relative w-full">
      <BigNumberField
        name="amount"
        label="Amount"
        // an empty string parses to NaN, which the field then shows
        value={value || undefined}
        minValue="0"
        variant={error ? "error" : undefined}
        message={error ?? availableText}
        // toString gives exponential notation below 1e-7 and from 1e+21, which no parser here accepts
        onChange={(entered) => onChange(entered.toFixed())}
        isReadOnly={isReadOnly}
        className={clsx(
          // Max sits at the right end of the message row; the library justifies it, which spaces out a wrapped line
          "w-full tabular-nums [&>div:last-child]:pr-10 [&>div:last-child]:text-left",
          // two lines held on a phone, where an over-balance line wraps, so the dialog keeps its height
          "max-sm:[&>div:last-child]:min-h-10 max-sm:[&>div:last-child]:items-start",
        )}
      />
      <LightButton
        small
        text="Max"
        isDisabled={isReadOnly || max === undefined || max === 0n}
        onPress={() => max !== undefined && onChange(formatUnits(max, decimals))}
        className={clsx(
          "absolute -right-1 -bottom-1 px-1 py-0.5 max-sm:bottom-4",
          "[&_.button-text]:text-fs-accent [&_.button-text]:text-sm",
        )}
      />
    </div>
  );
}

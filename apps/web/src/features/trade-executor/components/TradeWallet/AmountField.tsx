import { BigNumberField } from "@kleros/ui-components-library";
import clsx from "clsx";
import { formatUnits } from "viem";

import LightButton from "@/components/ui/LightButton";

import { ownedAmount } from "@/utils/amount";

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
}) {
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
        // Max sits at the right end of the message row
        className="w-full [&>div:last-child]:pr-10"
      />
      <LightButton
        small
        text="Max"
        isDisabled={isReadOnly || available === undefined}
        onPress={() => available !== undefined && onChange(formatUnits(available, decimals))}
        className={clsx(
          "absolute -right-1 -bottom-1 px-1 py-0.5",
          "[&_.button-text]:text-fs-accent [&_.button-text]:text-sm",
        )}
      />
    </div>
  );
}

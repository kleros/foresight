import { BigNumberField } from "@kleros/ui-components-library";
import clsx from "clsx";
import { formatUnits } from "viem";

import LightButton from "@/components/ui/LightButton";

import { formatAmount } from "@/utils/amount";

export function AmountField({
  value,
  onChange,
  available,
  decimals,
  symbol,
  error,
  isLoadingBalance,
  isReadOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  available: bigint | undefined;
  decimals: number;
  symbol: string;
  error?: string;
  isLoadingBalance?: boolean;
  isReadOnly?: boolean;
}) {
  const availableText = isLoadingBalance
    ? "Loading…"
    : // a balance we could not read must not read as an empty one
      available === undefined
      ? "Balance unavailable"
      : `Available: ${formatAmount(available, decimals)} ${symbol}`;

  return (
    <div className="relative w-full">
      <BigNumberField
        isRequired
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
        className="w-full"
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

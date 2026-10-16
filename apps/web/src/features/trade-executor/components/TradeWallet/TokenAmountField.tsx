import { BigNumberField } from "@kleros/ui-components-library";
import clsx from "clsx";
import { formatUnits } from "viem";

import LightButton from "@/components/ui/LightButton";
import { Select } from "@/components/ui/Select";

import DaiIcon from "@/assets/svg/dai.svg";

import { cutToOwned, ownedAmount } from "@/utils/amount";

export interface TokenChoice {
  id: string;
  symbol: string;
  decimals: number;
}

export function TokenAmountField({
  value,
  onChange,
  tokens,
  selected,
  onSelectToken,
  available,
  decimals,
  error,
  isLoadingBalance,
  isReadOnly,
  maxIsExact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  tokens: TokenChoice[];
  selected: string;
  onSelectToken: (id: string) => void;
  available: bigint | undefined;
  decimals: number;
  error?: string;
  isLoadingBalance?: boolean;
  isReadOnly?: boolean;
  /** Max takes the whole balance rather than the shown amount. */
  maxIsExact?: boolean;
}) {
  const max = available === undefined ? undefined : maxIsExact ? available : cutToOwned(available, decimals);
  const symbol = tokens.find((token) => token.id === selected)?.symbol ?? "";

  return (
    <div className="relative mb-8 w-full md:min-w-lg">
      <div className="border-fs-border rounded-fs flex h-fit flex-row border">
        <BigNumberField
          name="amount"
          className={clsx(
            "inline-block flex-1 tabular-nums max-md:w-max",
            "[&_input]:rounded-r-none [&_input]:border-none [&_input]:focus:shadow-none",
          )}
          onChange={(entered) => onChange(entered.toFixed())}
          minValue="0"
          variant={error ? "error" : undefined}
          value={value || undefined}
          isReadOnly={isReadOnly}
        />
        <Select
          label="Token"
          hideLabel
          options={tokens.map((token) => ({
            id: token.id,
            text: token.symbol,
            icon: <DaiIcon className="mr-2 size-6" />,
          }))}
          value={selected}
          onChange={onSelectToken}
          isDisabled={isReadOnly}
          className={clsx(
            "[&>button]:bg-fs-surface-tint [&>button]:h-11.25 [&>button]:w-fit",
            "[&>button]:border-none [&>button]:focus:shadow-none",
            "[&>button]:rounded-l-none",
            "[&>svg]:fill-fs-text-secondary [&>svg]:size-3",
          )}
        />
      </div>
      <LightButton
        small
        text="Max"
        isDisabled={isReadOnly || max === undefined || max === 0n}
        onPress={() => max !== undefined && onChange(formatUnits(max, decimals))}
        className={clsx("absolute -right-1 px-1 py-0.5", "[&_.button-text]:text-fs-accent [&_.button-text]:text-sm")}
      />
      {error ? (
        <span className="text-fs-tone-error absolute mt-1 text-xs">{error}</span>
      ) : (
        <span className="text-fs-text-primary absolute mt-1 text-xs tabular-nums">
          {isLoadingBalance
            ? "Reading balance…"
            : // a balance we could not read must not read as an empty one
              available === undefined
              ? "Could not read balance"
              : `Balance: ${ownedAmount(available, decimals)} ${symbol}`}
        </span>
      )}
    </div>
  );
}

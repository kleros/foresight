import { CustomAccordion, Tooltip } from "@kleros/ui-components-library";
import clsx from "clsx";

import { formatAmount } from "@/utils/amount";

import type { TradeWalletOption } from "../../types";

/**
 * What the wallet holds of each outcome's token.
 */
export function OptionBalances({
  options,
  balances,
  noun,
  decimals,
}: {
  options: TradeWalletOption[];
  /** Aligned with `options`; undefined until the reads land. */
  balances: bigint[] | undefined;
  noun: string;
  decimals: number;
}) {
  if (options.length === 0) return null;

  return (
    <CustomAccordion
      className="w-full max-w-full [&_#body-wrapper]:px-0 [&_#expand-button]:px-4!"
      items={[
        {
          title: <span className="text-fs-text-primary text-sm first-letter:uppercase">{noun} tokens</span>,
          body: (
            <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(11rem,16rem))] place-content-center gap-4 px-4">
              {options.map((option, index) => (
                <OptionBalance key={option.token} option={option} balance={balances?.[index]} decimals={decimals} />
              ))}
            </div>
          ),
        },
      ]}
    />
  );
}

function OptionBalance({
  option,
  balance,
  decimals,
}: {
  option: TradeWalletOption;
  balance: bigint | undefined;
  decimals: number;
}) {
  return (
    <div className="bg-fs-surface-tint flex h-min min-w-0 items-center">
      <span
        className={clsx(
          "mr-4 w-24 shrink-0 truncate px-3 py-2",
          "rounded-fs border-fs-border rounded-r-none border border-r-0",
          "bg-fs-surface text-fs-text-secondary text-sm",
        )}
        title={balance === undefined ? undefined : formatAmount(balance, decimals)}
      >
        {balance === undefined ? "—" : formatAmount(balance, decimals)}
      </span>
      <span className="mr-2 size-2 flex-none rounded-full" style={{ backgroundColor: option.color }} aria-hidden />
      <Tooltip text={option.name} closeDelay={125}>
        <span className="text-fs-text-primary min-w-0 truncate text-sm">{option.name}</span>
      </Tooltip>
    </div>
  );
}

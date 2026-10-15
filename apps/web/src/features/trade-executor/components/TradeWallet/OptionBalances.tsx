import { Tooltip } from "@kleros/ui-components-library";
import clsx from "clsx";
import type { Address } from "viem";

import WithHelpTooltip from "@/components/ui/WithHelpTooltip";

import { formatAmount } from "@/utils/amount";

import type { TradeWalletOption } from "../../types";

/** The market page's position row shows holdings at 2 decimals too; the full amount is in each title. */
const SHOWN_DIGITS = 2;

/**
 * What the wallet holds of each outcome's token, and of the UP and DOWN beneath it.
 */
export function OptionBalances({
  options,
  balances,
  positions,
  noun,
  decimals,
}: {
  options: TradeWalletOption[];
  /** Aligned with `options`; undefined until the reads land. */
  balances: bigint[] | undefined;
  /** Balance per position token; undefined until the read lands. */
  positions: ReadonlyMap<Address, bigint | undefined> | undefined;
  /** Singular, as in "movie tokens". */
  noun: string;
  decimals: number;
}) {
  if (options.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <WithHelpTooltip tooltipMsg="UP gains if it resolves high, DOWN if low.">
        <h4 className="type-label text-fs-text-secondary first-letter:uppercase">{noun} tokens</h4>
      </WithHelpTooltip>
      <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(11rem,16rem))] gap-4">
        {options.map((option, index) => (
          <OptionBalance
            key={option.token}
            option={option}
            balance={balances?.[index]}
            positions={positions}
            decimals={decimals}
          />
        ))}
      </div>
    </div>
  );
}

function OptionBalance({
  option,
  balance,
  positions,
  decimals,
}: {
  option: TradeWalletOption;
  balance: bigint | undefined;
  positions: ReadonlyMap<Address, bigint | undefined> | undefined;
  decimals: number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="bg-fs-surface-tint flex h-min min-w-0 items-center">
        <span
          className={clsx(
            "mr-4 min-w-28 shrink-0 px-3 py-2 tabular-nums",
            "rounded-fs border-fs-border rounded-r-none border border-r-0",
            "bg-fs-surface text-fs-text-secondary text-sm",
          )}
          title={balance === undefined ? undefined : formatAmount(balance, decimals)}
        >
          {balance === undefined ? "—" : formatAmount(balance, decimals, SHOWN_DIGITS)}
        </span>
        <span className="mr-2 size-2 flex-none rounded-full" style={{ backgroundColor: option.color }} aria-hidden />
        {/* the Tooltip's trigger div is the flex child, so it takes the min-w-0 the name needs to truncate */}
        <Tooltip text={option.name} closeDelay={125} wrapperProps={{ className: "min-w-0" }}>
          <span className="text-fs-text-primary min-w-0 truncate text-sm">{option.name}</span>
        </Tooltip>
      </div>
      {option.positions.length > 0 ? (
        <ul aria-label={`${option.name} positions`} className="flex flex-wrap gap-x-4 gap-y-1 px-3 text-sm">
          {option.positions.map(({ side, token }) => {
            const held = positions?.get(token);
            return (
              <li key={token} className="flex min-w-0 gap-1.5">
                <span className="text-fs-text-secondary">{side}</span>{" "}
                <span
                  className="text-fs-text-primary truncate"
                  title={held === undefined ? undefined : formatAmount(held, decimals)}
                >
                  {held === undefined ? "—" : formatAmount(held, decimals, SHOWN_DIGITS)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

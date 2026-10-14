import { CustomAccordion, Tooltip } from "@kleros/ui-components-library";
import clsx from "clsx";
import type { Address } from "viem";

import { formatAmount } from "@/utils/amount";

import type { TradeWalletOption } from "../../types";

/** Enough to tell holdings apart; the full amount is in each box's title. */
const SHOWN_DIGITS = 4;

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
                <OptionBalance
                  key={option.token}
                  option={option}
                  balance={balances?.[index]}
                  positions={positions}
                  decimals={decimals}
                />
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
            "mr-4 w-28 shrink-0 truncate px-3 py-2 tabular-nums",
            "rounded-fs border-fs-border rounded-r-none border border-r-0",
            "bg-fs-surface text-fs-text-secondary text-sm",
          )}
          title={balance === undefined ? undefined : formatAmount(balance, decimals)}
        >
          {balance === undefined ? "—" : formatAmount(balance, decimals, SHOWN_DIGITS)}
        </span>
        <span className="mr-2 size-2 flex-none rounded-full" style={{ backgroundColor: option.color }} aria-hidden />
        <Tooltip text={option.name} closeDelay={125}>
          <span className="text-fs-text-primary min-w-0 truncate text-sm">{option.name}</span>
        </Tooltip>
      </div>
      {option.positions.length > 0 ? (
        <ul
          aria-label={`${option.name} positions`}
          title="UP gains the higher this option resolves, DOWN the lower"
          className="flex flex-wrap gap-x-4 gap-y-1 px-3 text-sm"
        >
          {option.positions.map(({ side, token }) => {
            const held = positions?.get(token);
            return (
              <li key={token} className="flex min-w-0 gap-1.5">
                <span className="text-fs-text-secondary">{side}</span>{" "}
                <span className="text-fs-text-primary truncate">
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

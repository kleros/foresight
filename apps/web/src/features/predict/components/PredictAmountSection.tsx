import type { CSSProperties } from "react";

import { BigNumberField, Slider } from "@kleros/ui-components-library";
import clsx from "clsx";
import { formatUnits, parseUnits } from "viem";

import LightButton from "@/components/ui/LightButton";
import { Select } from "@/components/ui/Select";

import DaiIcon from "@/assets/svg/dai.svg";

import { ownedAmount } from "@/utils/amount";

import type { PayToken } from "../types";
import { fundingSummary, percentOf, roundToDisplay, shareOf, type Funding } from "../utils/funding";

export interface PayTokenChoice {
  id: PayToken;
  symbol: string;
  decimals: number;
}

interface PredictAmountSectionProps {
  amount: bigint | undefined;
  onAmountChange: (amount: bigint | undefined) => void;
  tokens: PayTokenChoice[];
  token: PayTokenChoice;
  onTokenChange: (token: PayToken) => void;
  /** Null while the balances are still being read. */
  funding: Funding | null;
  collateral: { symbol: string; decimals: number };
  isFirstPrediction: boolean;
  isReadOnly: boolean;
  /** No wallet is connected, so no balance is being read. */
  isDisconnected?: boolean;
  /** Said in place of the funding summary and the balance, for an amount the visitor cannot change. */
  note?: string;
}

export function PredictAmountSection({
  amount,
  onAmountChange,
  tokens,
  token,
  onTokenChange,
  funding,
  collateral,
  isFirstPrediction,
  isReadOnly,
  isDisconnected = false,
  note,
}: PredictAmountSectionProps) {
  const available = funding?.available;
  const over = amount !== undefined && available !== undefined && amount > available;
  // a locked amount is the one a run started with; a balance read since cannot make it too much
  const notEnough = over && !isReadOnly;
  const roundDown = (value: bigint) => roundToDisplay(value, token.decimals);
  const max = available === undefined ? undefined : roundDown(available);
  const summary = note
    ? { text: note, tone: "neutral" }
    : over && isReadOnly
      ? null
      : !isFirstPrediction && !isReadOnly && funding && !amount
        ? { text: "Trades from your trade wallet, nothing added", tone: "neutral" }
        : fundingSummary({ funding, amount, token, collateral });

  return (
    <div className="flex w-full flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="type-label text-fs-text-secondary min-w-0 truncate">
          {isFirstPrediction ? (
            "You pay"
          ) : (
            <>
              Extra funds<span className="max-sm:hidden"> (optional)</span>
            </>
          )}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-fs-text-secondary text-xs whitespace-nowrap">
            {note
              ? ""
              : isDisconnected
                ? "No wallet connected"
                : available === undefined
                  ? "Reading balance…"
                  : `Balance: ${ownedAmount(available, token.decimals)} ${token.symbol}`}
          </span>
          <LightButton
            small
            text="Max"
            isDisabled={isReadOnly || !max}
            onPress={() => max !== undefined && onAmountChange(max)}
            className={clsx(
              // a 44px target that takes no more height than its label
              "-my-3 min-h-11 min-w-11 justify-center rounded-none! p-0 hover:bg-transparent!",
              "[&_.button-text]:text-fs-text-accent [&_.button-text]:text-xs [&_.button-text]:font-semibold",
              "data-disabled:[&_.button-text]:text-fs-text-secondary",
            )}
          />
        </div>
      </div>

      <div
        data-testid="amount-input"
        className={clsx("border-fs-border rounded-fs flex h-fit flex-row border", isReadOnly && "opacity-50")}
      >
        <BigNumberField
          isRequired
          // the field names its input only through its own label; "You pay" above is what shows
          label="Amount"
          className={clsx(
            "inline-block min-w-0 flex-1 [&>label]:sr-only",
            "[&_input]:rounded-r-none [&_input]:border-none [&_input]:focus:shadow-none",
          )}
          minValue="0"
          variant={notEnough ? "error" : undefined}
          value={amount !== undefined ? formatUnits(amount, token.decimals) : undefined}
          // toString goes exponential below 1e-7, which parseUnits refuses
          onChange={(entered) => onAmountChange(toUnits(entered.toFixed(), token.decimals))}
          isReadOnly={isReadOnly}
        />
        <Select
          label="Token"
          hideLabel
          options={tokens.map((choice) => ({
            id: choice.id,
            text: choice.symbol,
            icon: <DaiIcon className="mr-2 size-6" />,
          }))}
          value={token.id}
          onChange={(id) => onTokenChange(id as PayToken)}
          isDisabled={isReadOnly || tokens.length < 2}
          className={clsx(
            "shrink-0 [&>button]:bg-fs-surface-tint [&>button]:h-11.25 [&>button]:w-fit",
            "[&>button]:border-none [&>button]:focus:shadow-none",
            "[&>button]:rounded-l-none",
            "[&>svg]:fill-fs-text-secondary [&>svg]:size-3",
          )}
        />
      </div>

      {/* a line's height held when empty, so the slider's floating label never lands on it; an amount wraps whole */}
      <p
        className={clsx(
          "mt-1.5 min-h-5 text-xs leading-5 break-words",
          summary?.tone === "error" ? "text-fs-tone-error-text" : "text-fs-text-secondary",
        )}
      >
        {summary?.text}
      </p>

      <AmountSlider
        percent={percentOf(amount ?? 0n, max ?? 0n)}
        isDisabled={isReadOnly || !max}
        onChange={(percent) => max !== undefined && onAmountChange(roundDown(shareOf(max, percent)))}
      />

      <hr className="border-fs-border mt-4 w-full short:mt-2" />
    </div>
  );
}

function toUnits(entered: string, decimals: number): bigint | undefined {
  try {
    return parseUnits(entered, decimals);
  } catch {
    return undefined;
  }
}

/** A share of the balance, with a dot at each quarter the fill has not reached yet. Dimmed whenever it cannot move. */
function AmountSlider({
  percent,
  isDisabled,
  onChange,
}: {
  percent: number;
  isDisabled: boolean;
  onChange: (percent: number) => void;
}) {
  return (
    <div
      data-testid="amount-slider"
      // typing the amount stands in for it where the steps would otherwise sit under the fold
      className={clsx("relative mt-4 w-[calc(100%-32px)] self-center short:hidden", isDisabled && "opacity-50")}
      style={{ "--label-shift": `${percent}%` } as CSSProperties}
    >
      <Slider
        className={clsx(
          "relative z-1 mt-0",
          // shifted by its own width times the share, the label ends at the thumb's centre at 100% and starts there at 0%
          "[&_#slider-label]:translate-x-[calc(-1*var(--label-shift))]",
          "[&_#slider-fill]:h-1 [&_#slider-track]:h-1",
          "[&_#slider-label]:text-fs-text-primary! [&_#slider-label]:font-semibold",
          // the field above already says the amount; at 0 the floating label is noise
          percent === 0 && "[&_#slider-label]:invisible",
          "[&_div:has(>#slider-label)[data-focus-visible]]:ring-fs-accent",
          "[&_div:has(>#slider-label)[data-focus-visible]]:ring-2",
          "[&_div:has(>#slider-label)[data-focus-visible]]:ring-offset-fs-surface",
          "[&_div:has(>#slider-label)[data-focus-visible]]:ring-offset-2",
        )}
        minValue={0}
        maxValue={100}
        value={percent}
        leftLabel=""
        rightLabel=""
        aria-label="Share of your balance"
        isDisabled={isDisabled}
        callback={onChange}
        formatter={(value) => `${value}%`}
      />
      <div
        className={clsx(
          "absolute top-3.5 left-0 z-0 -translate-y-1/2",
          "pointer-events-none flex w-full justify-between",
        )}
        aria-hidden
      >
        {[0, 25, 50, 75, 100].map((mark) => (
          <span
            key={mark}
            className={clsx("block size-2 rounded-full", mark < percent || mark === 0 ? "invisible" : "bg-fs-border")}
          />
        ))}
      </div>
    </div>
  );
}

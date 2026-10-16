import { BigNumberField, Slider } from "@kleros/ui-components-library";
import clsx from "clsx";
import { formatUnits, parseUnits } from "viem";

import LightButton from "@/components/ui/LightButton";
import { Select } from "@/components/ui/Select";

import DaiIcon from "@/assets/svg/dai.svg";

import { ownedAmount } from "@/utils/amount";

import { PredictSpineNode } from "./PredictSpineNode";
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

const RETURNING_COPY = "You've predicted before, so you can change it without adding funds.";

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
      : !isFirstPrediction && funding && !amount
        ? { text: RETURNING_COPY, tone: "neutral" }
        : fundingSummary({ funding, amount, token, collateral });

  const noBalance = Boolean(note) || isDisconnected;
  const balance = note
    ? ""
    : isDisconnected
      ? "No wallet connected"
      : available === undefined
        ? "Reading balance…"
        : `Balance: ${ownedAmount(available, token.decimals)} ${token.symbol}`;

  return (
    <PredictSpineNode
      done={isReadOnly}
      delayed
      title={
        isFirstPrediction ? (
          "You pay"
        ) : (
          <>
            Extra funds
            <span className="type-caption text-fs-text-secondary ml-1.5 font-normal max-sm:hidden">optional</span>
          </>
        )
      }
      right={
        // always under the title below 416px, where whether it fits beside the title depends on the balance's digits;
        // above, the title, an 11-digit balance and Max fit on one line
        <div className="ml-auto flex min-w-0 items-baseline gap-2 @max-[26rem]:basis-full @max-[26rem]:justify-between">
          <span className="type-caption text-fs-text-secondary min-w-0 truncate">{balance}</span>
          <LightButton
            small
            text="Max"
            isDisabled={isReadOnly || !max || noBalance}
            onPress={() => max !== undefined && onAmountChange(max)}
            className={clsx(
              // a 44px target that takes no more height than its label
              "-my-3 min-h-11 min-w-11 shrink-0 justify-end rounded-none! p-0 hover:bg-transparent!",
              "[&_.button-text]:text-fs-text-accent [&_.button-text]:text-xs [&_.button-text]:font-semibold",
              "data-disabled:[&_.button-text]:text-fs-text-secondary",
              // hidden, not removed: its baseline sets the title row's height
              noBalance && "invisible",
            )}
          />
        </div>
      }
    >
      <div
        data-testid="amount-input"
        className={clsx(
          "border-fs-border rounded-fs flex h-fit flex-row border",
          "transition-opacity duration-(--fs-dur-enter) ease-(--fs-ease-enter)",
          isReadOnly && "opacity-50",
        )}
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
          placeholder="0"
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

      {/* two lines held on a phone and one above, whatever it says, so no state moves the steps */}
      <p
        className={clsx(
          "mt-1 min-h-10 text-xs leading-5 text-pretty wrap-anywhere sm:min-h-5",
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
    </PredictSpineNode>
  );
}

function toUnits(entered: string, decimals: number): bigint | undefined {
  try {
    return parseUnits(entered, decimals);
  } catch {
    return undefined;
  }
}

/** A share of the balance, said beside the track, with a dot at each quarter the fill has not reached yet. Dimmed whenever it cannot move. */
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
      className={clsx(
        // a 44px hit area on a 16px row: the track overhangs into these margins, never into the summary
        "mt-3.5 mb-1.5 flex h-4 items-center gap-3 short:hidden",
        "transition-opacity duration-(--fs-dur-enter) ease-(--fs-ease-enter)",
        isDisabled && "opacity-50",
      )}
    >
      <div className="relative mx-2 h-4 min-w-0 flex-1">
        <Slider
          className={clsx(
            "relative z-1 mt-0 w-full",
            "[&>div:last-child]:hidden [&_#slider-label]:hidden",
            "[&_div:has(>#slider-track)]:-my-3.5 [&_div:has(>#slider-track)]:h-11",
            "[&_#slider-fill]:h-1 [&_#slider-track]:h-1",
            "[&_div:has(>#slider-label)]:size-4 [&_div:has(>#slider-label)]:border-2",
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
          // without one the library renders a live <output> in the thumb
          formatter={(value) => `${value}%`}
        />
        <div
          className="pointer-events-none absolute top-1/2 -left-1 z-0 flex w-[calc(100%+8px)] -translate-y-1/2 justify-between"
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
      <span
        data-testid="amount-share"
        className="text-fs-text-secondary w-9 shrink-0 text-right text-xs leading-4 tabular-nums"
      >
        {percent}%
      </span>
    </div>
  );
}

import { AlertMessage, BigNumberField, Slider } from "@kleros/ui-components-library";
import clsx from "clsx";
import { formatUnits, parseUnits } from "viem";

import LightButton from "@/components/ui/LightButton";
import { Select } from "@/components/ui/Select";

import DaiIcon from "@/assets/svg/dai.svg";

import { formatAmount } from "@/utils/amount";

import { AMOUNT_DISPLAY_DECIMALS } from "../oracle/tolerances";
import type { PayToken } from "../types";
import { percentOf, shareOf, type Funding } from "../utils/funding";

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
}: PredictAmountSectionProps) {
  const available = funding?.available;
  const notEnough = amount !== undefined && available !== undefined && amount > available;
  const isNative = token.id === "native";
  const roundDown = (value: bigint) => roundToDisplay(value, token.decimals);
  const max = available === undefined ? undefined : roundDown(available);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="mb-2 flex w-full flex-col">
        {isFirstPrediction ? null : (
          <AlertMessage
            title="Note"
            variant="info"
            msg="Since you've already made a prediction, you can change it even without adding extra funds."
            className={clsx(
              "[&_small]:text-fs-text-secondary mb-3 p-2 py-3 [&_small]:text-xs",
              "bg-fs-surface-tint border-none",
            )}
          />
        )}

        <div className="relative mb-5 w-full md:min-w-lg">
          <div className="flex items-center justify-between gap-2">
            <span className="text-fs-text-secondary mb-1 text-sm">{isFirstPrediction ? "You pay" : "Extra funds"}</span>
            <div className="flex items-center gap-2">
              <span className="text-fs-text-secondary text-xs">
                {isDisconnected
                  ? "Connect a wallet to see your balance"
                  : available === undefined
                    ? "Checking your balance…"
                    : `Balance: ${formatAmount(available, token.decimals)} ${token.symbol}`}
              </span>
              <LightButton
                small
                text="Max"
                isDisabled={isReadOnly || available === undefined}
                onPress={() => max !== undefined && onAmountChange(max)}
                className={clsx(
                  "p-0 hover:bg-transparent!",
                  "[&_.button-text]:text-fs-accent [&_.button-text]:text-xs [&_.button-text]:font-semibold",
                )}
              />
            </div>
          </div>

          <div className="border-fs-border rounded-fs flex h-fit flex-row border">
            <BigNumberField
              isRequired
              aria-label="Amount"
              className={clsx(
                "inline-block flex-1 max-md:w-fit",
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
                "[&>button]:bg-fs-surface-tint [&>button]:h-11.25 [&>button]:w-fit",
                "[&>button]:border-none [&>button]:focus:shadow-none",
                "[&>button]:rounded-l-none",
                "[&>svg]:fill-fs-text-secondary [&>svg]:size-3",
              )}
            />
          </div>

          {notEnough ? (
            <span className="text-fs-tone-error absolute text-xs">Not enough balance.</span>
          ) : isNative && funding && funding.collateralIn > 0n ? (
            <span className="text-fs-text-primary absolute text-xs">
              Equivalent {collateral.symbol} ~{formatAmount(funding.collateralIn, collateral.decimals)}
            </span>
          ) : null}
        </div>

        <AmountSlider
          percent={percentOf(amount ?? 0n, max ?? 0n)}
          isDisabled={isReadOnly || !max}
          onChange={(percent) => max !== undefined && onAmountChange(roundDown(shareOf(max, percent)))}
        />

        <hr className="border-fs-border my-4 w-full" />

        {funding && amount !== undefined && amount > 0n ? (
          <p className="flex flex-row flex-wrap items-center text-xs">
            <span className="text-fs-text-primary font-semibold">
              Total: {formatAmount(funding.collateralIn, collateral.decimals)} {collateral.symbol} =
            </span>
            <span className="text-fs-text-secondary">
              {funding.fromTradeWallet > 0n ? (
                <span>
                  &nbsp;{formatAmount(funding.fromTradeWallet, collateral.decimals)} ({collateral.symbol} in Trade
                  Wallet)
                </span>
              ) : null}
              {funding.fromTradeWallet > 0n && funding.toAdd > 0n ? <span>&nbsp;+</span> : null}
              {funding.toAdd > 0n ? (
                <span>&nbsp;{formatAmount(funding.toAdd, collateral.decimals)} (Your Wallet)</span>
              ) : null}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Rounded down to the decimals the popup shows, so the signed amount is the shown amount. */
export function roundToDisplay(value: bigint, decimals: number): bigint {
  const step = 10n ** BigInt(Math.max(decimals - AMOUNT_DISPLAY_DECIMALS, 0));
  return value - (value % step);
}

function toUnits(entered: string, decimals: number): bigint | undefined {
  try {
    return parseUnits(entered, decimals);
  } catch {
    return undefined;
  }
}

/** A share of the balance, with a dot at each quarter the fill has not reached yet. */
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
    <div className="relative mt-4 w-[calc(100%-32px)] self-center">
      <Slider
        className={clsx(
          "relative z-1",
          "[&_#slider-fill]:h-1 [&_#slider-track]:h-1",
          "[&_#slider-label]:text-fs-text-primary! [&_#slider-label]:font-semibold",
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
          "absolute top-1/2 left-0 z-0 -translate-y-full",
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

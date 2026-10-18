import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { BigNumberField, Slider } from "@kleros/ui-components-library";
import clsx from "clsx";
import { formatUnits, parseUnits } from "viem";

import LightButton from "@/components/ui/LightButton";
import { Select } from "@/components/ui/Select";

import DaiIcon from "@/assets/svg/dai.svg";

import { formatDisplayAmount, ownedAmount } from "@/utils/amount";

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
/** The amount's font sizes, largest first; below 16px a phone zooms the page into the focused field. */
const AMOUNT_SIZES = [30, 24, 20, 16];

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

  const { field, fit } = useFittedAmount();
  const [isEditing, setIsEditing] = useState(false);
  // the library groups only in its own blur handler, so a value set from outside shows ungrouped until then
  const atRest =
    !isEditing && amount ? { value: formatDisplayAmount(amount, token.decimals, token.decimals) } : undefined;
  const noBalance = Boolean(note) || isDisconnected;
  const isRead = !isDisconnected && available !== undefined;
  const figure = isDisconnected
    ? "No wallet connected"
    : available === undefined
      ? "Reading balance…"
      : `${ownedAmount(available, token.decimals)} ${token.symbol}`;

  return (
    <section
      data-panel="amount"
      className={clsx(
        "@container rounded-fs-panel bg-fs-popup-panel p-4 short:px-3.5 short:py-2.5",
        "[background-image:var(--fs-popup-wash)]",
        // the field draws no ring of its own, so the panel wears the popup's 2px focus ring, inside its edge
        "has-[[data-testid=amount-input]_input:focus-visible]:ring-fs-focus-ring",
        "has-[[data-testid=amount-input]_input:focus-visible]:ring-2 has-[[data-testid=amount-input]_input:focus-visible]:ring-inset",
      )}
    >
      {/* the balance wraps under the title only when the two do not fit one line, and always on a phone under 375px */}
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-3">
        <h3 className="type-label text-fs-popup-text-2 grid min-w-0 shrink-0 font-medium">
          <span className="col-start-1 row-start-1 truncate">{isFirstPrediction ? "You pay" : "Extra funds"}</span>
          {/* either title takes the wider one's room, so a returning predictor's row wraps where a first one's does */}
          {isFirstPrediction ? (
            <span aria-hidden className="invisible col-start-1 row-start-1">
              Extra funds
            </span>
          ) : null}
        </h3>
        <div className="ml-auto flex h-5 min-w-0 items-center justify-end gap-2 @max-[17rem]:basis-full @max-[17rem]:justify-between">
          {/* a note stands in for the balance, which keeps its room so the row wraps as it would;
              where the figure does not fit beside "Balance:", the label wraps onto a hidden second line */}
          <span
            aria-hidden={note ? true : undefined}
            title={note ? undefined : isRead ? `Balance: ${figure}` : figure}
            className={clsx(
              "flex h-5 min-w-0 flex-row-reverse flex-wrap content-start gap-x-1 overflow-hidden",
              "text-fs-popup-text-2 text-[13px] leading-5 tabular-nums",
              note && "invisible",
            )}
          >
            {isRead ? <span className="shrink-0">Balance: </span> : null}
            <span data-testid="balance-figure" className="order-first min-w-0 truncate">
              {figure}
            </span>
          </span>
          <LightButton
            small
            text="Max"
            isDisabled={isReadOnly || !max || noBalance}
            onPress={() => max !== undefined && onAmountChange(max)}
            className={clsx(
              // a 44px target that takes no more height than its label, reaching into the gap before it
              "-my-3 -ml-2 min-h-11 min-w-11 shrink-0 justify-end rounded-md! p-0 hover:bg-transparent!",
              "[&_.button-text]:text-fs-popup-accent-text [&_.button-text]:text-xs [&_.button-text]:font-semibold",
              "[&_.button-text]:tracking-wide [&_.button-text]:uppercase",
              "data-disabled:[&_.button-text]:text-fs-popup-text-3",
              // hidden, not removed, so the row keeps its shape
              noBalance && "invisible",
            )}
          />
        </div>
      </div>

      <div
        ref={field}
        data-testid="amount-input"
        onInput={fit}
        onFocus={(event) => event.target instanceof HTMLInputElement && setIsEditing(true)}
        // the library rewrites the value after a blur, in its own render
        onBlur={(event) => {
          if (event.target instanceof HTMLInputElement) setIsEditing(false);
          requestAnimationFrame(fit);
        }}
        className={clsx(
          "mt-2 flex h-11 flex-row items-center gap-3 short:mt-1.5 short:h-10",
          "transition-opacity duration-(--fs-dur-enter) ease-(--fs-ease-enter)",
          isReadOnly && "opacity-50",
        )}
      >
        <BigNumberField
          isRequired
          // the field names its input only through its own label; the panel's title is what shows
          label="Amount"
          className={clsx(
            "inline-block min-w-0 flex-1 [&>label]:sr-only",
            "[&_input]:h-11 [&_input]:border-none [&_input]:bg-transparent [&_input]:px-0 [&_input]:shadow-none!",
            "[&_input]:text-[30px] [&_input]:leading-9 [&_input]:font-medium",
            // the library's stepper arrows would sit over the last digits
            "[&_.input-wrapper>div:has(>button)]:hidden!",
            "[&_input]:tracking-[-0.02em] [&_input]:tabular-nums [&_input]:placeholder:text-fs-popup-text-3",
            "[&_input]:focus:shadow-none",
            // a focus scroll on a phone on its side keeps the line under the field above the sticky button
            "landscape-phone:[&_input]:scroll-mb-12",
            // the line under the field names the limit, so too much tints the digits rather than adding an icon
            notEnough
              ? "[&_input]:text-fs-tone-error-text [&_.input-wrapper>svg]:hidden"
              : "[&_input]:text-fs-popup-text",
          )}
          minValue="0"
          placeholder="0"
          variant={notEnough ? "error" : undefined}
          value={amount !== undefined ? formatUnits(amount, token.decimals) : undefined}
          // toString goes exponential below 1e-7, which parseUnits refuses
          onChange={(entered) => onAmountChange(toUnits(entered.toFixed(), token.decimals))}
          isReadOnly={isReadOnly}
          inputProps={atRest}
        />
        <Select
          label="Token"
          hideLabel
          options={tokens.map((choice) => ({
            id: choice.id,
            text: choice.symbol,
            icon: <DaiIcon className="mr-2 size-7" />,
          }))}
          value={token.id}
          onChange={(id) => onTokenChange(id as PayToken)}
          isDisabled={isReadOnly || tokens.length < 2}
          className={clsx(
            "shrink-0 [&>button]:bg-fs-popup-chip [&>button]:h-10 [&>button]:w-fit [&>button]:rounded-full",
            "[&>button]:border-none [&>button]:pl-1.5 [&>button]:focus:shadow-none",
            "[&>button]:text-fs-popup-text [&>button]:font-semibold predict-token-select",
            // the library's label box runs 16px past its glyphs; with no caret, 3px matches the icon's side
            tokens.length < 2 ? "predict-token-select-single [&>button]:pr-0.75" : "[&>button]:pr-2.5",
          )}
          menuClassName={clsx(
            "fs-aurora rounded-fs-control bg-fs-surface border-fs-popup-line",
            "[&_#listbox]:bg-transparent [&_#listbox]:py-1",
            "[&_[role=option]]:h-10 [&_[role=option]]:py-0 [&_[role=option]]:pr-3 [&_[role=option]]:pl-3",
            // the list clips at its sides, so a row's ring sits inside its edge
            "[&_[role=option]]:[--fs-focus-offset:-2px]",
            "[&_[role=option]_p]:text-fs-popup-text [&_[role=option]_p]:text-[15px] [&_[role=option]_p]:font-medium",
            "[&_[role=option]:hover]:bg-fs-popup-hover [&_[role=option][data-focused]]:bg-fs-popup-hover",
            // the choice wears the chip tone, without the library's bar; its label in the accent, as dark hover is the chip tone too
            "[&_[role=option][data-selected]]:bg-fs-popup-chip [&_[role=option][data-selected]]:border-l-0",
            "[&_[role=option][data-selected]_p]:text-fs-popup-accent-text [&_[role=option][data-selected]_p]:font-semibold",
          )}
        />
      </div>

      {/* two lines held, whatever it says, so no state moves the steps */}
      <p
        className={clsx(
          "mt-1.5 min-h-9 text-[13px] leading-[18px] text-pretty tabular-nums wrap-anywhere",
          summary?.tone === "error" ? "text-fs-tone-error-text" : "text-fs-popup-text-2",
        )}
      >
        {summary?.text}
      </p>

      <AmountSlider
        percent={percentOf(amount ?? 0n, max ?? 0n)}
        isDisabled={isReadOnly || !max}
        onChange={(percent) => max !== undefined && onAmountChange(roundDown(shareOf(max, percent)))}
      />
    </section>
  );
}

/** Sets the amount field's input to the largest size its number fits at, rather than scroll, down to the floor. */
function useFittedAmount() {
  const field = useRef<HTMLDivElement>(null);
  const fit = useCallback(() => {
    const input = field.current?.querySelector("input");
    if (!input) return;
    for (const size of AMOUNT_SIZES) {
      input.style.fontSize = `${size}px`;
      if (input.scrollWidth <= input.clientWidth) return;
    }
  }, []);
  // every render, since the amount, the token chip and the panel's width all move the fit
  useLayoutEffect(fit);
  useEffect(() => {
    const input = field.current?.querySelector("input");
    if (!input) return;
    const observer = new ResizeObserver(fit);
    observer.observe(input);
    // Inter's digits are narrower than the fallback's
    void document.fonts?.ready.then(fit);
    return () => observer.disconnect();
  }, [fit]);
  return { field, fit };
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
        "mt-3.5 flex h-4 items-center gap-3 short:hidden",
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
            "[&_#slider-fill]:h-1 [&_#slider-track]:h-1 [&_#slider-track]:bg-fs-popup-track",
            "[&_#slider-fill]:[background:var(--fs-popup-axis)]",
            "[&_div:has(>#slider-label)]:size-4 [&_div:has(>#slider-label)]:border-2",
            "[&_div:has(>#slider-label)]:border-(--fs-popup-axis-to) [&_div:has(>#slider-label)]:bg-fs-surface",
            "[&_div:has(>#slider-label)[data-focus-visible]]:ring-fs-focus-ring",
            "[&_div:has(>#slider-label)[data-focus-visible]]:ring-2",
            "[&_div:has(>#slider-label)[data-focus-visible]]:ring-offset-fs-popup-panel",
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
          className="pointer-events-none absolute top-1/2 -left-[3px] z-0 flex w-[calc(100%+6px)] -translate-y-1/2 justify-between"
          aria-hidden
        >
          {[0, 25, 50, 75, 100].map((mark) => (
            <span
              key={mark}
              className={clsx(
                "block size-1.5 rounded-full",
                mark < percent || mark === 0 ? "invisible" : "bg-fs-popup-track-dot",
              )}
            />
          ))}
        </div>
      </div>
      <span
        data-testid="amount-share"
        className="text-fs-popup-text-2 w-9 shrink-0 text-right text-xs leading-4 tabular-nums"
      >
        {percent}%
      </span>
    </div>
  );
}

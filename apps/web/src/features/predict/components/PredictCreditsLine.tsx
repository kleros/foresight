import clsx from "clsx";

import LightButton from "@/components/ui/LightButton";

import { ownedAmount } from "@/utils/amount";

import type { CreditsOffer } from "../utils/credits";

export interface CreditsChoice {
  offer: CreditsOffer;
  /** The visitor's tick; it spends nothing while the offer has nothing usable. */
  isUsing: boolean;
  onUsingChange: (isUsing: boolean) => void;
}

const CREDIT_DECIMALS = 18;

/** What the visitor's credits can cover, said under the tick. */
function creditsNote(offer: CreditsOffer): string {
  if (offer.state === "none") return "";
  const count = (value: bigint) => ownedAmount(value, CREDIT_DECIMALS);
  if (offer.state === "usable") return `${count(offer.usable)} credits available`;
  if (offer.state === "short") return `${count(offer.usable)} of ${count(offer.held)} usable now`;
  // no figure, so the instruction fits whole at 320px for any holding
  return "None usable now. Use your own funds.";
}

/**
 * The credits tick under the amount, with "Max credits" while ticked; with none usable, the same
 * two rows without the tick. Every state holds that height, so nothing below it moves.
 */
export function PredictCreditsLine({
  credits,
  isReadOnly,
  onUseMax,
}: {
  credits: CreditsChoice;
  isReadOnly: boolean;
  /** Sets the amount to everything the credits cover; absent when they cover nothing. */
  onUseMax?: () => void;
}) {
  const { offer, isUsing, onUsingChange } = credits;
  const hasUsable = offer.state === "usable" || offer.state === "short";
  const isTicked = isUsing && hasUsable;
  const canUseMax = isTicked && !isReadOnly && onUseMax !== undefined;
  const canTick = hasUsable && !isReadOnly;
  const note = creditsNote(offer);

  return (
    // positioned, so its targets paint over the share slider's hit area above it
    <div
      data-testid="credits-line"
      className="border-fs-popup-line relative mt-3 border-t pt-2.5 short:mt-2 short:pt-2"
    >
      <div className="flex h-5 items-center justify-between gap-3">
        {hasUsable ? (
          <label
            className={clsx(
              // a 44px target on the 20px row, as the buttons beside it
              "group -my-3 flex min-w-0 items-center gap-2 py-3 text-[13px] leading-5 font-medium",
              canTick ? "text-fs-popup-text cursor-pointer" : "text-fs-popup-text-3",
            )}
          >
            <input
              type="checkbox"
              aria-label="Use Foresight credits"
              className="peer sr-only"
              checked={isTicked}
              disabled={!canTick}
              onChange={(event) => onUsingChange(event.target.checked)}
            />
            <span
              aria-hidden
              className={clsx(
                "predict-check grid size-4 shrink-0 place-items-center rounded-[5px] border",
                "border-fs-popup-line-strong bg-fs-surface peer-checked:border-transparent",
                canTick && "[@media(hover:hover)]:group-hover:border-fs-popup-text-3",
                "peer-focus-visible:ring-fs-focus-ring peer-focus-visible:ring-2 peer-focus-visible:ring-offset-1",
                "peer-focus-visible:ring-offset-fs-popup-panel peer-disabled:opacity-60",
              )}
            >
              <svg viewBox="0 0 10.17 10.17" className="size-2.5" fill="none">
                <path
                  d="M1 5.52L3.92 9.17L9.17 1"
                  stroke="var(--fs-popup-on-axis)"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            {/* under 272px of panel the name gives way to Max credits; the input keeps it as its label */}
            <span aria-hidden className="truncate @max-[17rem]:hidden">
              Use Foresight credits
            </span>
            <span aria-hidden className="hidden truncate @max-[17rem]:inline">
              Use credits
            </span>
          </label>
        ) : (
          <span className="text-fs-popup-text-2 truncate text-[13px] leading-5 font-medium">Foresight credits</span>
        )}
        <LightButton
          small
          text="Max credits"
          isDisabled={!canUseMax}
          onPress={() => onUseMax?.()}
          className={clsx(
            // a 44px target that takes no more height than its label
            "-my-3 -mr-2 min-h-11 shrink-0 justify-end rounded-md! px-2 hover:bg-transparent!",
            "[&_.button-text]:text-fs-popup-accent-text [&_.button-text]:text-xs [&_.button-text]:font-semibold",
            "[&_.button-text]:tracking-wide [&_.button-text]:uppercase",
            "transition-opacity duration-(--fs-dur-enter) ease-(--fs-ease-enter)",
            // hidden, not removed, so the row keeps its shape
            !canUseMax && "invisible opacity-0",
          )}
        />
      </div>
      <p
        data-testid="credits-note"
        title={note}
        className={clsx(
          "text-fs-popup-text-2 mt-0.5 min-h-4 truncate text-xs leading-4 tabular-nums",
          hasUsable && "pl-6",
        )}
      >
        {note}
      </p>
    </div>
  );
}

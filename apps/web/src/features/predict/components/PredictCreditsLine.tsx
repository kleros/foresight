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
function creditsNote(offer: CreditsOffer, collateralSymbol: string): string {
  if (offer.state === "none") return "";
  const count = (value: bigint) => ownedAmount(value, CREDIT_DECIMALS);
  if (offer.state === "usable") return `${count(offer.usable)} credits available`;
  if (offer.state === "short") return `${count(offer.usable)} of your ${count(offer.held)} credits usable right now`;
  return `None usable right now. Add your own ${collateralSymbol}.`;
}

/**
 * The credits tick under the amount, with "Use max" while ticked. Every state holds the same two
 * rows, so ticking, unticking or a short manager moves nothing below it.
 */
export function PredictCreditsLine({
  credits,
  collateralSymbol,
  isReadOnly,
  onUseMax,
}: {
  credits: CreditsChoice;
  collateralSymbol: string;
  isReadOnly: boolean;
  /** Sets the amount to everything the credits cover; absent when they cover nothing. */
  onUseMax?: () => void;
}) {
  const { offer, isUsing, onUsingChange } = credits;
  const hasUsable = offer.state === "usable" || offer.state === "short";
  const isTicked = isUsing && hasUsable;
  const canUseMax = isTicked && !isReadOnly && onUseMax !== undefined;

  return (
    <div data-testid="credits-line" className="border-fs-popup-line mt-3 border-t pt-2.5 short:mt-2 short:pt-2">
      <div className="flex h-5 items-center justify-between gap-3">
        <label
          className={clsx(
            "group flex min-w-0 items-center gap-2 text-[13px] leading-5 font-medium",
            hasUsable && !isReadOnly ? "text-fs-popup-text cursor-pointer" : "text-fs-popup-text-3",
          )}
        >
          <input
            type="checkbox"
            className="peer sr-only"
            checked={isTicked}
            disabled={!hasUsable || isReadOnly}
            onChange={(event) => onUsingChange(event.target.checked)}
          />
          <span
            aria-hidden
            className={clsx(
              "predict-check grid size-4 shrink-0 place-items-center rounded-[5px] border",
              "border-fs-popup-line-strong bg-fs-surface",
              "peer-checked:border-transparent peer-checked:[background:var(--fs-popup-axis)]",
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
          <span className="truncate">Use your Foresight credits</span>
        </label>
        <LightButton
          small
          text="Use max"
          isDisabled={!canUseMax}
          onPress={() => onUseMax?.()}
          className={clsx(
            // a 44px target that takes no more height than its label
            "-my-3 -mr-2 min-h-11 shrink-0 justify-end rounded-md! px-2 hover:bg-transparent!",
            "[&_.button-text]:text-fs-popup-accent-text [&_.button-text]:text-xs [&_.button-text]:font-semibold",
            "transition-opacity duration-(--fs-dur-enter) ease-(--fs-ease-enter)",
            // hidden, not removed, so the row keeps its shape
            !canUseMax && "invisible opacity-0",
          )}
        />
      </div>
      <p
        data-testid="credits-note"
        className={clsx(
          "mt-0.5 min-h-4 pl-6 text-xs leading-4 text-pretty tabular-nums",
          offer.state === "empty" ? "text-fs-tone-warning-text" : "text-fs-popup-text-2",
        )}
      >
        {creditsNote(offer, collateralSymbol)}
      </p>
    </div>
  );
}

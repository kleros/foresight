import { forwardRef, useId, useState, type KeyboardEvent } from "react";

import clsx from "clsx";

import { INERT } from "@/utils/inert";

import { DEFAULT_SLIPPAGE, MAX_SLIPPAGE_BPS } from "../oracle/tolerances";
import {
  isHighSlippage,
  parseSlippagePercent,
  slippagePercent,
  type SlippageKind,
  type SlippageSettings,
} from "../utils/slippage";

const FIELDS: { kind: SlippageKind; label: string; hint: string }[] = [
  {
    kind: "tradeBps",
    label: "Max slippage on trades",
    hint: "How far each trade may fill from its planned price.",
  },
  {
    kind: "creditsBps",
    label: "Max slippage on the credits swap",
    hint: "How far the swap of your credits may fill below its quote.",
  },
];

/**
 * The popup's settings, laid over everything under its header so the popup keeps its size: max slippage,
 * Auto or the visitor's own percent, for the trades and for the credits swap.
 */
export const PredictSettings = forwardRef<
  HTMLButtonElement,
  {
    id: string;
    /** Names the panel: the header's title. */
    labelledBy: string;
    isOpen: boolean;
    settings: SlippageSettings;
    onChange: (kind: SlippageKind, bps: number | null) => void;
    onClose: () => void;
  }
>(function PredictSettings({ id, labelledBy, isOpen, settings, onChange, onClose }, firstControl) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    // the popup closes on Escape too; here it closes only the settings
    event.stopPropagation();
    onClose();
  };

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={labelledBy}
      data-open={isOpen || undefined}
      onKeyDown={onKeyDown}
      {...(isOpen ? {} : INERT)}
      className={clsx(
        // 8px past the column each side, over the rings and glows its controls draw outside it; a landscape
        // phone's column already reaches into the dialog's padding, and anything past it would scroll sideways
        "predict-settings bg-fs-surface absolute -inset-x-2 top-10 bottom-0 z-30 overflow-y-auto px-2 pb-4",
        "landscape-phone:inset-x-0 landscape-phone:pr-3 landscape-phone:pl-1",
        // concentric with the dialog's 24px corners, 8px in from its edge on a phone and 12px from md
        "rounded-b-2xl md:rounded-b-xl",
      )}
    >
      <div className="flex flex-col gap-2">
        {FIELDS.map((field, index) => (
          <SlippageField
            key={field.kind}
            ref={index === 0 ? firstControl : undefined}
            {...field}
            value={settings[field.kind]}
            onChange={(bps) => onChange(field.kind, bps)}
          />
        ))}
      </div>
    </div>
  );
});

const SlippageField = forwardRef<
  HTMLButtonElement,
  {
    kind: SlippageKind;
    label: string;
    hint: string;
    /** Basis points, or null on Auto. */
    value: number | null;
    onChange: (bps: number | null) => void;
  }
>(function SlippageField({ kind, label, hint, value, onChange }, autoRef) {
  const labelId = useId();
  const hintId = useId();
  const messageId = useId();
  // what the field holds while typed; a committed value is shown as the store has it
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? "" : slippagePercent(value));
  const parsed = parseSlippagePercent(shown);
  const isInvalid = parsed === "invalid";
  const isHigh = value !== null && isHighSlippage(kind, value);
  const isAuto = value === null && draft === null;

  const type = (text: string) => {
    setDraft(text);
    const bps = parseSlippagePercent(text);
    if (bps !== "invalid") onChange(bps);
  };

  const message = isInvalid
    ? { text: `Enter a percent from 0 to ${slippagePercent(MAX_SLIPPAGE_BPS)}.`, tone: "text-fs-tone-error-text" }
    : isHigh
      ? { text: "High slippage. A trade may fill at a much worse price.", tone: "text-fs-tone-warning-text" }
      : { text: `Auto is ${slippagePercent(DEFAULT_SLIPPAGE[kind])}%.`, tone: "text-fs-popup-text-3" };

  return (
    <section data-slippage={kind} className="rounded-fs-panel bg-fs-popup-panel flex flex-col gap-1.5 px-4 pt-3 pb-2.5">
      <h3 id={labelId} className="type-label text-fs-popup-text font-medium">
        {label}
      </h3>
      <p id={hintId} className="text-fs-popup-text-2 text-xs leading-4 text-pretty">
        {hint}
      </p>
      <div className="mt-0.5 flex h-9 items-center gap-2">
        <button
          ref={autoRef}
          type="button"
          aria-pressed={isAuto}
          aria-describedby={labelId}
          onClick={() => {
            setDraft(null);
            onChange(null);
          }}
          className={clsx(
            "type-label h-9 shrink-0 cursor-pointer rounded-fs-control px-3.5 font-medium",
            "transition-colors duration-(--fs-dur-echo) ease-(--fs-ease-enter)",
            isAuto
              ? "bg-(image:--fs-popup-axis) text-fs-popup-on-axis"
              : "bg-fs-popup-chip text-fs-popup-text-2 [@media(hover:hover)]:hover:text-fs-popup-text",
          )}
        >
          Auto
        </button>
        <label
          className={clsx(
            "flex h-9 w-28 min-w-0 items-center rounded-fs-control border px-3",
            // the field's own outline is off, so the box takes the one keyboard ring
            "focus-within:outline-2 focus-within:outline-offset-[-1px] focus-within:outline-(--fs-focus-ring)",
            isInvalid ? "border-(--fs-tone-error)" : "border-(--fs-popup-line-strong)",
          )}
        >
          <span className="sr-only">{`${label}, custom percent`}</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={shown}
            placeholder={slippagePercent(DEFAULT_SLIPPAGE[kind])}
            aria-invalid={isInvalid || undefined}
            aria-describedby={`${hintId} ${messageId}`}
            onChange={(event) => type(event.target.value)}
            onBlur={() => setDraft(null)}
            className={clsx(
              "type-label text-fs-popup-text placeholder:text-fs-popup-text-3 min-w-0 flex-1 bg-transparent",
              "text-right tabular-nums outline-none",
            )}
          />
          <span aria-hidden className="text-fs-popup-text-2 type-label pl-1">
            %
          </span>
        </label>
      </div>
      <p id={messageId} aria-live="polite" className={clsx("min-h-4 text-xs leading-4 text-pretty", message.tone)}>
        {message.text}
      </p>
    </section>
  );
});

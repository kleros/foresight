import { useId, useState, type KeyboardEvent, type Ref, type RefObject } from "react";

import clsx from "clsx";

import { ScrollFade } from "@/components/ui/ScrollFade";

import { INERT } from "@/utils/inert";

import { PredictButton } from "./PredictButton";
import { DEFAULT_SLIPPAGE, MAX_SLIPPAGE_BPS, MIN_SLIPPAGE_BPS } from "../oracle/tolerances";
import {
  isHighSlippage,
  isLowSlippage,
  parseSlippagePercent,
  slippagePercent,
  type SlippageKind,
  type SlippageSettings,
} from "../utils/slippage";

const FIELDS: { kind: SlippageKind; label: string; hint: string; high: string; low: string }[] = [
  {
    kind: "tradeBps",
    label: "Max slippage on trades",
    hint: "How far each trade may fill from its planned price.",
    high: "High slippage. A trade may fill at a much worse price.",
    low: "Low slippage. A trade may fail if the pool moves at all.",
  },
  {
    kind: "creditsBps",
    label: "Max slippage on the credits swap",
    hint: "How far the swap of your credits may fill below its quote.",
    high: "High slippage. The swap may pay much less than its quote.",
    low: "Low slippage. The swap may fail if the pool moves at all.",
  },
];

const RANGE_ERROR = `Enter a percent from ${slippagePercent(MIN_SLIPPAGE_BPS)} to ${slippagePercent(MAX_SLIPPAGE_BPS)}.`;

/** Every control in `panel` a Tab can reach, in order. */
const reachable = (panel: HTMLElement | null): HTMLElement[] =>
  Array.from(panel?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])") ?? []);

/**
 * The popup's settings, laid over everything under its header so the popup keeps its size: max slippage,
 * Auto or the visitor's own percent, for the trades and, for a visitor with credits, the credits swap.
 */
export function PredictSettings({
  id,
  labelledBy,
  isOpen,
  settings,
  onChange,
  onClose,
  hasCredits,
  panelRef,
  firstControlRef,
  onTabPastEnd,
}: {
  id: string;
  /** Names the panel: the header's title. */
  labelledBy: string;
  isOpen: boolean;
  settings: SlippageSettings;
  onChange: (kind: SlippageKind, bps: number | null) => void;
  onClose: () => void;
  /** The visitor holds credits, so the credits swap's setting can apply to their run. */
  hasCredits: boolean;
  panelRef: RefObject<HTMLDivElement>;
  firstControlRef: Ref<HTMLButtonElement>;
  /** Tab from the panel's last control; the header's controls come next. */
  onTabPastEnd: () => void;
}) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      // the popup closes on Escape too; here it closes only the settings
      event.stopPropagation();
      onClose();
      return;
    }
    // the body under the panel is inert, so the dialog's own wrap finds nothing past the last control
    if (event.key === "Tab" && !event.shiftKey && event.target === reachable(panelRef.current).at(-1)) {
      event.preventDefault();
      event.stopPropagation();
      onTabPastEnd();
    }
  };

  return (
    <div
      ref={panelRef}
      id={id}
      role="group"
      aria-labelledby={labelledBy}
      data-open={isOpen || undefined}
      onKeyDown={onKeyDown}
      {...(isOpen ? {} : INERT)}
      className={clsx(
        // 8px past the column each side, over the rings and glows its controls draw outside it; a landscape
        // phone's column already reaches into the dialog's padding, and anything past it would scroll sideways
        "predict-settings bg-fs-surface absolute -inset-x-2 top-10 bottom-0 z-30 flex flex-col px-2",
        "landscape-phone:inset-x-0 landscape-phone:pr-3 landscape-phone:pl-1",
        // concentric with the dialog's 24px corners, 8px in from its edge on a phone and 12px from md
        "rounded-b-2xl md:rounded-b-xl",
      )}
    >
      <ScrollFade className="min-h-0 flex-1" minOverflow={1} fadeSize={32}>
        <div className="flex flex-col gap-2">
          {FIELDS.filter((field) => hasCredits || field.kind !== "creditsBps").map((field, index) => (
            <SlippageField
              key={field.kind}
              autoRef={index === 0 ? firstControlRef : undefined}
              {...field}
              value={settings[field.kind]}
              onChange={(bps) => onChange(field.kind, bps)}
            />
          ))}
        </div>
      </ScrollFade>
      {/* in the button's own place under the body, so the way back is where the eye ends */}
      <div className="landscape-phone:pb-2 shrink-0 pt-1 pb-4 short:pb-3">
        <PredictButton text="Done" quiet isDisabled={!isOpen} onPress={onClose} />
      </div>
    </div>
  );
}

function SlippageField({
  kind,
  label,
  hint,
  high,
  low,
  value,
  onChange,
  autoRef,
}: {
  kind: SlippageKind;
  label: string;
  hint: string;
  /** Said under a value over the kind's high threshold. */
  high: string;
  /** Said under a value under the kind's low threshold. */
  low: string;
  /** Basis points, or null on Auto. */
  value: number | null;
  onChange: (bps: number | null) => void;
  autoRef?: Ref<HTMLButtonElement>;
}) {
  const labelId = useId();
  const hintId = useId();
  const messageId = useId();
  // what the field holds while typed, or after it left the field invalid; nothing is saved until it is valid
  const [draft, setDraft] = useState<string | null>(null);
  const [isFocused, setFocused] = useState(false);
  const shown = draft ?? (value === null ? "" : slippagePercent(value));
  const parsed = parseSlippagePercent(shown);
  // judged once the visitor leaves the field, not mid-number
  const isInvalid = parsed === "invalid" && !isFocused;
  const isHigh = value !== null && isHighSlippage(kind, value);
  const isLow = value !== null && isLowSlippage(kind, value);
  const isAuto = value === null && draft === null;

  const commit = () => {
    if (draft === null || parsed === "invalid") return;
    onChange(parsed);
    setDraft(null);
  };

  const message = isInvalid
    ? { text: RANGE_ERROR, tone: "text-fs-tone-error-text", icon: true }
    : isHigh
      ? { text: high, tone: "text-fs-tone-warning-text", icon: true }
      : isLow
        ? { text: low, tone: "text-fs-tone-warning-text", icon: true }
        : { text: `Auto is ${slippagePercent(DEFAULT_SLIPPAGE[kind])}%.`, tone: "text-fs-popup-text-3", icon: false };

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
            "type-label relative h-9 shrink-0 cursor-pointer rounded-fs-control px-3.5 font-medium",
            // a 44px target in the row's 36px
            "before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
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
            "relative flex h-9 w-28 min-w-0 items-center rounded-fs-control border px-3",
            "before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
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
            placeholder="Custom"
            aria-invalid={isInvalid || undefined}
            aria-describedby={`${hintId} ${messageId}`}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              commit();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
            }}
            className={clsx(
              "type-label text-fs-popup-text placeholder:text-fs-popup-text-3 relative min-w-0 flex-1 bg-transparent",
              "text-right tabular-nums outline-none",
            )}
          />
          {/* an empty field reads as empty, with no unit after its placeholder */}
          {shown === "" ? null : (
            <span aria-hidden className="text-fs-popup-text-2 type-label relative">
              %
            </span>
          )}
        </label>
      </div>
      <p
        id={messageId}
        aria-live="polite"
        className={clsx("flex min-h-4 items-start gap-1 text-xs leading-4 text-pretty", message.tone)}
      >
        {message.icon ? <AlertIcon /> : null}
        <span>{message.text}</span>
      </p>
    </section>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden className="size-4 shrink-0">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.75v3.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11" r="0.9" fill="currentColor" />
    </svg>
  );
}

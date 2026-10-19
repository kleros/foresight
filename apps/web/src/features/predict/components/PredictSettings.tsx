import { useEffect, useId, useState, type KeyboardEvent, type Ref, type RefObject } from "react";

import clsx from "clsx";

import { INERT } from "@/utils/inert";

import { DEFAULT_SLIPPAGE, MAX_SLIPPAGE_BPS, MIN_SLIPPAGE_BPS } from "../oracle/tolerances";
import {
  isHighSlippage,
  isLowSlippage,
  parseSlippagePercent,
  SLIPPAGE_LABEL,
  slippagePercent,
  type SlippageKind,
  type SlippageSettings,
} from "../utils/slippage";

const FIELDS: { kind: SlippageKind; hint: string; high: string; low: string }[] = [
  {
    kind: "tradeBps",
    hint: "How far a trade may fill from its plan.",
    high: "High slippage. A trade may fill at a much worse price.",
    low: "Low slippage. A trade may fail if the pool moves at all.",
  },
  {
    kind: "creditsBps",
    hint: "How far the swap may fill below its quote.",
    high: "High slippage. The swap may pay much less than its quote.",
    low: "Low slippage. The swap may fail if the pool moves at all.",
  },
];

const RANGE_ERROR = `Enter a percent from ${slippagePercent(MIN_SLIPPAGE_BPS)} to ${slippagePercent(MAX_SLIPPAGE_BPS)}.`;

/** Every control in `panel` a Tab can reach, in order. */
export const reachable = (panel: HTMLElement | null): HTMLElement[] =>
  Array.from(panel?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])") ?? []);

/**
 * The popup's settings: a small card under its header over the dimmed body, so the popup keeps its size. Max
 * slippage, Auto or the visitor's own percent, for the trades and, for a visitor with credits, the credits swap.
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
  // a Reset drops what each field holds unsaved, so every field remounts on it
  const [resets, setResets] = useState(0);
  // closing drops an entry left invalid too, so the panel never reopens on a value the run does not use
  const [closes, setCloses] = useState(0);
  const [wasOpen, setWasOpen] = useState(isOpen);
  const [drafted, setDrafted] = useState<Partial<Record<SlippageKind, boolean>>>({});
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (!isOpen) {
      setCloses((count) => count + 1);
      setDrafted({});
    }
  }
  const fields = FIELDS.filter((field) => hasCredits || field.kind !== "creditsBps");
  const isCustom = fields.some((field) => settings[field.kind] !== null || drafted[field.kind]);
  useEffect(() => {
    // Reset disables itself, so the focus moves on to the first choice
    if (resets > 0) reachable(panelRef.current)[0]?.focus();
  }, [resets, panelRef]);

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
      // the dimmed body around the card closes it, as a click outside a menu does
      onClick={(event) => (event.target === event.currentTarget ? onClose() : undefined)}
      {...(isOpen ? {} : INERT)}
      className={clsx(
        // 8px past the column each side, over the rings and glows its controls draw outside it; a landscape
        // phone's column already reaches into the dialog's padding, and anything past it would scroll sideways
        "predict-settings bg-fs-surface/85 absolute -inset-x-2 top-10 bottom-0 z-30 overflow-y-auto px-2 pt-1 pb-4",
        "landscape-phone:inset-x-0 landscape-phone:pr-3 landscape-phone:pl-1",
        // concentric with the dialog's 24px corners, 8px in from its edge on a phone and 12px from md
        "rounded-b-2xl md:rounded-b-xl",
      )}
    >
      <div
        className={clsx(
          "predict-settings-card rounded-fs-panel bg-fs-popup-panel flex flex-col gap-2 border px-3.5 pt-3 pb-3",
          "border-(--fs-popup-line) shadow-(--fs-popup-shadow)",
        )}
      >
        {fields.map((field, index) => (
          <SlippageField
            key={`${field.kind}-${resets}-${closes}`}
            autoRef={index === 0 ? firstControlRef : undefined}
            {...field}
            value={settings[field.kind]}
            onChange={(bps) => onChange(field.kind, bps)}
            onDrafted={(isDrafted) =>
              setDrafted((was) => (Boolean(was[field.kind]) === isDrafted ? was : { ...was, [field.kind]: isDrafted }))
            }
          />
        ))}
        <div className="mt-1 flex items-center justify-between gap-3 border-t border-(--fs-popup-line) pt-3">
          <button
            type="button"
            disabled={!isCustom}
            onClick={() => {
              for (const field of FIELDS) if (settings[field.kind] !== null) onChange(field.kind, null);
              setResets((count) => count + 1);
              setDrafted({});
            }}
            className={clsx(
              "type-label text-fs-popup-accent-text relative -ml-2 h-8 cursor-pointer rounded-fs-control px-2",
              "font-medium transition-colors duration-(--fs-dur-echo) ease-(--fs-ease-enter)",
              "[@media(hover:hover)]:hover:bg-fs-popup-hover disabled:cursor-default disabled:opacity-40",
              "disabled:hover:bg-transparent before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']",
            )}
          >
            Reset
          </button>
          {/* the last control, so Tab from it wraps to the gear */}
          <button
            type="button"
            disabled={!isOpen}
            onClick={onClose}
            className={clsx(
              "type-label text-fs-popup-text bg-fs-popup-chip relative h-8 cursor-pointer rounded-fs-control px-4",
              "font-semibold transition-colors duration-(--fs-dur-echo) ease-(--fs-ease-enter)",
              "[@media(hover:hover)]:hover:bg-fs-popup-hover before:absolute before:inset-x-0 before:-inset-y-1.5",
              "before:content-['']",
            )}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function SlippageField({
  kind,
  hint,
  high,
  low,
  value,
  onChange,
  onDrafted,
  autoRef,
}: {
  kind: SlippageKind;
  hint: string;
  /** Said under a value over the kind's high threshold. */
  high: string;
  /** Said under a value under the kind's low threshold. */
  low: string;
  /** Basis points, or null on Auto. */
  value: number | null;
  onChange: (bps: number | null) => void;
  /** Told whether the field holds an entry that is not saved. */
  onDrafted: (isDrafted: boolean) => void;
  autoRef?: Ref<HTMLButtonElement>;
}) {
  const label = SLIPPAGE_LABEL[kind];
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
  const autoValue = slippagePercent(DEFAULT_SLIPPAGE[kind]);
  const isDrafted = draft !== null;
  useEffect(() => onDrafted(isDrafted), [isDrafted, onDrafted]);

  const commit = () => {
    if (draft === null || parsed === "invalid") return;
    onChange(parsed);
    setDraft(null);
  };

  const message = isInvalid
    ? { text: RANGE_ERROR, tone: "text-fs-tone-error-text" }
    : isHigh
      ? { text: high, tone: "text-fs-tone-warning-text" }
      : isLow
        ? { text: low, tone: "text-fs-tone-warning-text" }
        : null;
  // the last message stays in place while its row folds away, then goes, so the same one is announced again
  const [folding, setFolding] = useState(message);
  if (message && (folding?.text !== message.text || folding.tone !== message.tone)) setFolding(message);
  const drawn = message ?? folding;

  return (
    <section data-slippage={kind} className="flex flex-col">
      {/* over the lines under it, so Auto's and the field's extended targets stay whole */}
      <div className="relative z-10 flex min-h-8 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <h3 id={labelId} className="type-label text-fs-popup-text font-medium">
          {label}
        </h3>
        <div className="ml-auto flex items-center gap-1">
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
              "type-label relative h-8 shrink-0 cursor-pointer rounded-fs-control px-2.5 font-medium",
              // a 44px target in the row's 32px
              "before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']",
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
              "bg-fs-surface relative flex h-8 w-[68px] min-w-0 items-center rounded-fs-control border px-2",
              "before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']",
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
              // on Auto the field shows the value in use
              placeholder={autoValue}
              aria-invalid={isInvalid || undefined}
              aria-describedby={message ? `${hintId} ${messageId}` : hintId}
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
            <span aria-hidden className="text-fs-popup-text-2 type-label relative pl-0.5">
              %
            </span>
          </label>
        </div>
      </div>
      <p id={hintId} className="text-fs-popup-text-3 text-xs leading-4 text-pretty">
        {hint}
        <span className="sr-only">{` Auto is ${autoValue}%.`}</span>
      </p>
      {/* folds open under the hint (transitions.dev 21) */}
      <div
        data-open={message ? true : undefined}
        className="predict-settings-message"
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && !message) setFolding(null);
        }}
      >
        <p id={messageId} aria-live="polite" className={clsx("min-h-0 text-xs leading-4 text-pretty", drawn?.tone)}>
          {drawn ? (
            <span className="flex items-start gap-1 pt-1">
              <AlertIcon />
              <span>{drawn.text}</span>
            </span>
          ) : null}
        </p>
      </div>
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

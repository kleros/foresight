import type { PredictSlippage } from "../flow/types";
import {
  DEFAULT_SLIPPAGE,
  HIGH_SLIPPAGE_BPS,
  LOW_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
  MIN_SLIPPAGE_BPS,
} from "../oracle/tolerances";

export type SlippageKind = keyof PredictSlippage;

/** The visitor's own slippage per swap kind, in basis points; null is Auto, the run's default. */
export type SlippageSettings = Record<SlippageKind, number | null>;

export const AUTO_SLIPPAGE: SlippageSettings = { tradeBps: null, creditsBps: null };

/** Each setting's one name, in the settings, in Details and for assistive tech. */
export const SLIPPAGE_LABEL: Record<SlippageKind, string> = {
  tradeBps: "Max slippage",
  creditsBps: "Credits swap slippage",
};

const isBps = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= MIN_SLIPPAGE_BPS && value <= MAX_SLIPPAGE_BPS;

/** Persisted settings are untrusted: a value that is not a whole number of basis points in range reads as Auto. */
export function normalizeSlippageSettings(value: unknown): SlippageSettings {
  const saved = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    tradeBps: isBps(saved.tradeBps) ? saved.tradeBps : null,
    creditsBps: isBps(saved.creditsBps) ? saved.creditsBps : null,
  };
}

/** The slippage a run uses: the visitor's value where they set one, the default elsewhere. */
export function resolveSlippage(settings: SlippageSettings): PredictSlippage {
  return {
    tradeBps: settings.tradeBps ?? DEFAULT_SLIPPAGE.tradeBps,
    creditsBps: settings.creditsBps ?? DEFAULT_SLIPPAGE.creditsBps,
  };
}

/**
 * A typed percent as basis points: up to two decimals, a comma read as a point, 0.01 to the cap.
 * Null for empty text, which is Auto; "invalid" for anything else.
 */
export function parseSlippagePercent(text: string): number | null | "invalid" {
  const trimmed = text.trim().replace(",", ".").replace(/%$/, "").trim();
  if (trimmed === "") return null;
  const match = /^(\d{1,3})(?:\.(\d{0,2}))?$|^\.(\d{1,2})$/.exec(trimmed);
  if (!match) return "invalid";
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? match[3] ?? "").padEnd(2, "0");
  const bps = Number(whole) * 100 + Number(fraction);
  return bps >= MIN_SLIPPAGE_BPS && bps <= MAX_SLIPPAGE_BPS ? bps : "invalid";
}

/** Basis points as a percent with no trailing zeros: 100 is `1`, 20 is `0.2`, 125 is `1.25`. */
export function slippagePercent(bps: number): string {
  return String(bps / 100);
}

/** A value above which a swap can lose far more than the pools usually move. */
export const isHighSlippage = (kind: SlippageKind, bps: number): boolean => bps > HIGH_SLIPPAGE_BPS[kind];

/** A value below which a swap is likely to revert on any move between its quote and its send. */
export const isLowSlippage = (kind: SlippageKind, bps: number): boolean => bps < LOW_SLIPPAGE_BPS[kind];

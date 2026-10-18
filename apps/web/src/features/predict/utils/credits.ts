import type { CreditsHeld } from "@/lib/trade-executor/credits";

import { MAX_CREDITS_PER_RUN } from "../oracle/tolerances";

/** Credits at or below 0.01 are not offered; 18 decimals. */
export const MIN_CREDITS = 10n ** 16n;

/**
 * What the popup offers: nothing at or below `MIN_CREDITS`; otherwise everything held when the
 * manager covers it and a run may spend it, the part it covers or `MAX_CREDITS_PER_RUN` when
 * either is lower, or none when what it covers is not worth offering.
 */
export type CreditsOffer =
  | { state: "none" }
  | { state: "usable" | "short"; held: bigint; usable: bigint }
  | { state: "empty"; held: bigint; usable: 0n };

export function creditsOffer(credits: CreditsHeld | null): CreditsOffer {
  if (!credits) return { state: "none" };
  const held = credits.wallet + credits.tradeWallet;
  if (held <= MIN_CREDITS) return { state: "none" };
  if (credits.manager <= MIN_CREDITS) return { state: "empty", held, usable: 0n };
  const cap = credits.manager < MAX_CREDITS_PER_RUN ? credits.manager : MAX_CREDITS_PER_RUN;
  if (cap >= held) return { state: "usable", held, usable: held };
  return { state: "short", held, usable: cap };
}

/**
 * A balance of credits that stands in for collateral one for one. `kind` names the issuer, so a
 * session's own credits can join the platform's as another line.
 */
export interface CreditLine {
  kind: "foresight";
  tradeWallet: bigint;
  /** The manager spends from its caller, the trade wallet, so these move there before a spend. */
  wallet: bigint;
  /** What the line's manager covers now, of both. */
  usable: bigint;
}

/** The line for an offer, or none when it has nothing usable. */
export function creditLines(credits: CreditsHeld | null, offer: CreditsOffer): CreditLine[] {
  if (!credits || offer.state === "none" || offer.usable === 0n) return [];
  return [{ kind: "foresight", tradeWallet: credits.tradeWallet, wallet: credits.wallet, usable: offer.usable }];
}

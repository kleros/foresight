import { cutToOwned, formatAmount, formatDisplayAmount, OWNED_DECIMALS } from "@/utils/amount";

import type { CreditLine } from "./credits";
import type { PredictRequest } from "../flow/types";
import { CREDITS_SLIPPAGE_BPS, GAS_RESERVE_WEI } from "../oracle/tolerances";
import type { PayToken } from "../types";

const WAD = 10n ** 18n;

/** Where the money for one prediction comes from, worked out as futarchy's popup does. */
export interface Funding {
  /**
   * What the visitor can put in, in the token they chose: their wallet less any gas reserve, the
   * trade wallet, and the credits the lines can spend.
   */
  available: bigint;
  /** The credits part of `available`, in the token they chose. */
  creditsAvailable: bigint;
  /** Collateral the prediction splits, credits included. */
  collateralIn: bigint;
  /** Credits the prediction spends, one per collateral unit, line by line. */
  credits: CreditUse[];
  /** The sum of `credits`. */
  creditsIn: bigint;
  /** Collateral in the trade wallet before anything is added. */
  tradeWallet: bigint;
  /** The part of it the prediction uses. */
  fromTradeWallet: bigint;
  /** Collateral that has to come from the visitor's own wallet. */
  toAdd: bigint;
  /** What the deposit sends, in the token they chose. */
  deposit: bigint;
}

export interface CreditUse {
  kind: CreditLine["kind"];
  fromTradeWallet: bigint;
  fromWallet: bigint;
}

export interface FundingArgs {
  /** In the token the visitor chose. */
  amount: bigint;
  /** The visitor's own wallet, in the token they chose. */
  ownWallet: bigint;
  /** Collateral already in the trade wallet. */
  tradeWallet: bigint;
  /**
   * Units of the chosen token one collateral unit is worth, as a wad. Absent when the chosen
   * token is the collateral itself; present means native xDAI, which keeps `GAS_RESERVE_WEI` back.
   */
  tokenPerCollateralWad?: bigint;
  /** Spent before any collateral, in order, each from the trade wallet before the visitor's wallet. */
  credits?: CreditLine[];
}

export function planFunding({
  amount,
  ownWallet,
  tradeWallet,
  tokenPerCollateralWad,
  credits = [],
}: FundingArgs): Funding {
  const rate = tokenPerCollateralWad ?? WAD;
  const toToken = (collateral: bigint) => (collateral * rate) / WAD;
  const toCollateral = (token: bigint) => (rate > 0n ? (token * WAD) / rate : 0n);
  const reserve = tokenPerCollateralWad === undefined ? 0n : GAS_RESERVE_WEI;
  const spendable = ownWallet > reserve ? ownWallet - reserve : 0n;

  let collateralIn = toCollateral(amount);
  let left = collateralIn;
  // each part in whole shown decimals, so what is signed and burned is what the popup shows
  const uses = credits.map((line): CreditUse => {
    const usable = min(left, line.usable);
    const fromTradeWallet = cutToOwned(min(usable, line.tradeWallet), CREDIT_DECIMALS);
    const fromWallet = cutToOwned(min(usable - fromTradeWallet, line.wallet), CREDIT_DECIMALS);
    left -= fromTradeWallet + fromWallet;
    return { kind: line.kind, fromTradeWallet, fromWallet };
  });
  // what the cut leaves below a shown decimal is not worth a deposit of its own
  if (left < CREDIT_STEP && uses.some((use) => use.fromTradeWallet + use.fromWallet > 0n)) {
    collateralIn -= left;
    left = 0n;
  }
  const toAdd = left > tradeWallet ? left - tradeWallet : 0n;
  // rounded up, so what lands covers the shortfall
  const depositNeeded = rate === WAD ? toAdd : (toAdd * rate + WAD - 1n) / WAD;
  const creditsAvailable = toToken(
    credits.reduce((sum, line) => sum + min(line.usable, line.tradeWallet + line.wallet), 0n),
  );

  return {
    available: spendable + toToken(tradeWallet) + creditsAvailable,
    creditsAvailable,
    collateralIn,
    credits: uses,
    creditsIn: collateralIn - left,
    tradeWallet,
    fromTradeWallet: left - toAdd,
    toAdd,
    deposit: depositNeeded > spendable ? spendable : depositNeeded,
  };
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);

const CREDIT_DECIMALS = 18;

/** One unit of the last decimal the popup shows a credit amount to. */
const CREDIT_STEP = 10n ** BigInt(CREDIT_DECIMALS - OWNED_DECIMALS);

/** What a run is asked to sign for `funding`: the sDAI split apart from the credits, and the credits by source. */
export function fundingRequest(
  funding: Funding,
  native: boolean,
): Pick<
  PredictRequest,
  "deposit" | "depositNative" | "collateralIn" | "collateralBefore" | "creditsFromEoa" | "creditsToSpend"
> {
  return {
    deposit: funding.deposit,
    depositNative: native,
    collateralIn: funding.collateralIn - funding.creditsIn,
    collateralBefore: funding.tradeWallet,
    creditsFromEoa: funding.credits.reduce((sum, use) => sum + use.fromWallet, 0n),
    creditsToSpend: funding.creditsIn,
  };
}

/**
 * The collateral a run is expected to split: the sDAI as is, and the credits at the floor their
 * swap is held to, before the pool's own fee and price, which only the quote knows.
 */
export const expectedSplit = (funding: Funding): bigint =>
  funding.collateralIn - funding.creditsIn + (funding.creditsIn * BigInt(10_000 - CREDITS_SLIPPAGE_BPS)) / 10_000n;

/** Rounded down to the decimals the popup shows, so the signed amount is the shown amount. */
export const roundToDisplay = cutToOwned;

/** A whole percentage of `balance`, rounded down. */
export const shareOf = (balance: bigint, percent: number): bigint => (balance * BigInt(Math.round(percent))) / 100n;

/** What share of `balance` the value is, as a whole percentage. */
export const percentOf = (value: bigint, balance: bigint): number =>
  balance === 0n ? 0 : Math.min(100, Number((value * 100n) / balance));

interface Token {
  symbol: string;
  decimals: number;
}

export interface FundingSummary {
  text: string;
  tone: "neutral" | "error";
}

/**
 * An amount at the popup's shown decimals, rounded to the nearest so a deposit a wei short of a
 * typed amount reads as typed; a non-zero amount below the last decimal is named, not shown as 0.
 */
export function shownAmount(value: bigint, decimals: number): string {
  const step = 10n ** BigInt(Math.max(decimals - OWNED_DECIMALS, 0));
  const shown = formatDisplayAmount(((value + step / 2n) / step) * step, decimals);
  return shown === "0" && value > 0n ? `less than ${formatAmount(step, decimals)}` : shown;
}

/**
 * The one line under the amount: the collateral the prediction uses and where it comes from, or,
 * over the balance, how much can be added. Null until an amount is typed.
 */
export function fundingSummary(args: {
  funding: Funding | null;
  amount: bigint | undefined;
  token: Token & { id: PayToken };
  collateral: Token;
}): FundingSummary | null {
  const { funding, amount, token, collateral } = args;
  if (!funding || amount === undefined || amount === 0n) return null;
  if (amount > funding.available) {
    const max = roundToDisplay(funding.available, token.decimals);
    const text =
      max === 0n
        ? "Not enough balance."
        : `Not enough balance. Max ${shownAmount(max, token.decimals)} ${token.symbol}.`;
    return { text, tone: "error" };
  }

  // credits reach the split through a swap, so their part is approximate, as an xDAI deposit is
  const approx = token.id === "native" || funding.creditsIn > 0n;
  const total = `${approx ? "≈ " : ""}${shownAmount(funding.collateralIn, collateral.decimals)} ${collateral.symbol}`;
  const parts = [
    { amount: funding.creditsIn, from: "in credits", alone: "from your credits" },
    { amount: funding.fromTradeWallet, from: "in your trade wallet", alone: "from your trade wallet" },
    { amount: funding.toAdd, from: "from your wallet", alone: "from your wallet" },
  ].filter((part) => part.amount > 0n);
  const text =
    parts.length > 1
      ? `${total} = ${parts.map((part) => `${shownAmount(part.amount, collateral.decimals)} ${part.from}`).join(" + ")}`
      : `${total} ${parts[0]?.alone ?? "from your wallet"}`;
  return { text, tone: "neutral" };
}

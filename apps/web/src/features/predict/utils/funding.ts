import { formatAmount } from "@/utils/amount";

import { AMOUNT_DISPLAY_DECIMALS, GAS_RESERVE_WEI } from "../oracle/tolerances";
import type { PayToken } from "../types";

const WAD = 10n ** 18n;

/** Where the money for one prediction comes from, worked out as futarchy's popup does. */
export interface Funding {
  /** What the visitor can put in, in the token they chose: their wallet less any gas reserve, plus the trade wallet. */
  available: bigint;
  /** Collateral the prediction splits. */
  collateralIn: bigint;
  /** Collateral in the trade wallet before anything is added. */
  tradeWallet: bigint;
  /** The part of it the prediction uses. */
  fromTradeWallet: bigint;
  /** Collateral that has to come from the visitor's own wallet. */
  toAdd: bigint;
  /** What the deposit sends, in the token they chose. */
  deposit: bigint;
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
}

export function planFunding({ amount, ownWallet, tradeWallet, tokenPerCollateralWad }: FundingArgs): Funding {
  const rate = tokenPerCollateralWad ?? WAD;
  const toToken = (collateral: bigint) => (collateral * rate) / WAD;
  const toCollateral = (token: bigint) => (rate > 0n ? (token * WAD) / rate : 0n);
  const reserve = tokenPerCollateralWad === undefined ? 0n : GAS_RESERVE_WEI;
  const spendable = ownWallet > reserve ? ownWallet - reserve : 0n;

  const collateralIn = toCollateral(amount);
  const toAdd = collateralIn > tradeWallet ? collateralIn - tradeWallet : 0n;
  // rounded up, so what lands covers the shortfall
  const depositNeeded = rate === WAD ? toAdd : (toAdd * rate + WAD - 1n) / WAD;

  return {
    available: spendable + toToken(tradeWallet),
    collateralIn,
    tradeWallet,
    fromTradeWallet: collateralIn - toAdd,
    toAdd,
    deposit: depositNeeded > spendable ? spendable : depositNeeded,
  };
}

/** Rounded down to the decimals the popup shows, so the signed amount is the shown amount. */
export function roundToDisplay(value: bigint, decimals: number): bigint {
  const step = 10n ** BigInt(Math.max(decimals - AMOUNT_DISPLAY_DECIMALS, 0));
  return value - (value % step);
}

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
  const step = 10n ** BigInt(Math.max(decimals - AMOUNT_DISPLAY_DECIMALS, 0));
  const shown = formatAmount(((value + step / 2n) / step) * step, decimals);
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
    return {
      text: `Not enough balance. You can add up to ${shownAmount(roundToDisplay(funding.available, token.decimals), token.decimals)} ${token.symbol}.`,
      tone: "error",
    };
  }

  const total = `${token.id === "native" ? "≈ " : ""}${shownAmount(funding.collateralIn, collateral.decimals)} ${collateral.symbol}`;
  const fromTrade = funding.fromTradeWallet > 0n;
  const fromWallet = funding.toAdd > 0n;
  const text =
    fromTrade && fromWallet
      ? `${total} = ${shownAmount(funding.fromTradeWallet, collateral.decimals)} in your trade wallet + ${shownAmount(funding.toAdd, collateral.decimals)} from your wallet`
      : fromTrade
        ? `${total} from your trade wallet`
        : `${total} from your wallet`;
  return { text, tone: "neutral" };
}

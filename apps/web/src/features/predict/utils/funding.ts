import { AMOUNT_DISPLAY_DECIMALS, GAS_RESERVE_WEI } from "../oracle/tolerances";

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

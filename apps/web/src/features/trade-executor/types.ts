import type { Address } from "viem";

/**
 * One outcome of the parent market, as the trade wallet needs it: a token to weigh, and a way to name it.
 *
 * Seer's MarketFactory wraps every outcome token with `decimals() == 18` whatever the collateral,
 * and the router mints and burns them 1:1 with collateral in raw units, a child's UP and DOWN
 * included. So an amount of one is scaled by the collateral's decimals, never the token's own.
 */
export interface TradeWalletOption {
  /** The parent market's wrapped outcome token for this outcome. */
  token: Address;
  name: string;
  color: string;
  /** This outcome's child market tokens; empty where the indexer has none. */
  positions: TradeWalletPosition[];
}

export interface TradeWalletPosition {
  side: "UP" | "DOWN";
  token: Address;
}

export interface TradeWalletMarket {
  parentMarket: Address;
  collateral: { address: Address; decimals: number; symbol: string };
  options: TradeWalletOption[];
  /** Minted and burnt alongside the options; without it the set cannot be merged back. */
  invalidToken: Address;
}

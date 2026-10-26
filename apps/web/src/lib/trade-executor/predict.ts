import type { Address } from "viem";

import type { SwapQuote } from "@/lib/swap/types";

import type { ExecutorCall } from "./executor";
import { approveCall, mergeCalls, splitCalls } from "./positions";

export interface QuotedSwap {
  /** The token leaving the executor, which the router must be approved for. */
  tokenIn: Address;
  quote: SwapQuote;
}

export interface OptionTrade {
  router: Address;
  /** The scalar market whose outcome tokens are traded. */
  childMarket: Address;
  /** The session's base collateral, which is what the router's own argument names. */
  collateral: Address;
  /** The parent outcome token this option's pools price against, and what a split here spends. */
  underlying: Address;
  outcomeTokens: Address[];
  invalidToken: Address;
  /** Underlying to split into a full outcome set first. */
  splitAmount: bigint;
  sells: QuotedSwap[];
  /** Outcome sets to merge back to underlying once the sells are done. */
  mergeAmount: bigint;
  buys: QuotedSwap[];
}

/**
 * An approve sits with its own swap: two legs spending one token would otherwise overwrite one
 * another's allowance instead of adding to it. A swap its price limit stops early leaves the rest
 * of the allowance standing, so it goes back to zero after.
 */
function swapCalls({ tokenIn, quote }: QuotedSwap): ExecutorCall[] {
  if (quote.value > 0n) {
    throw new Error("A swap between outcome tokens cannot carry native currency.");
  }

  return [
    approveCall(tokenIn, quote.router, quote.amountIn),
    { to: quote.router, data: quote.data },
    approveCall(tokenIn, quote.router, 0n),
  ];
}

/** One option's prediction as executor calls: split, sell, merge, buy, each step funding the next. */
export function optionTradeCalls(trade: OptionTrade): ExecutorCall[] {
  const { router, collateral } = trade;
  const market = trade.childMarket;
  // A child's set is minted from the parent's outcome token, though the router still names the
  // session's collateral: that is how it identifies the condition underneath.
  const deposited = trade.underlying;
  const calls: ExecutorCall[] = [];

  if (trade.splitAmount > 0n) {
    calls.push(...splitCalls({ router, collateral, deposited, market, amount: trade.splitAmount }));
  }

  calls.push(...trade.sells.flatMap(swapCalls));

  if (trade.mergeAmount > 0n) {
    calls.push(
      ...mergeCalls({
        router,
        collateral,
        market,
        outcomeTokens: trade.outcomeTokens,
        invalidToken: trade.invalidToken,
        amount: trade.mergeAmount,
      }),
    );
  }

  calls.push(...trade.buys.flatMap(swapCalls));

  return calls;
}

"use client";

import type { Address } from "viem";

import type { SessionDetail } from "@/features/sessions/types";
import { useTokenBalances } from "@/features/trade-executor/api/getTokenBalances";

/** True once the trade wallet holds any of the session's outcome tokens, INVALID included. */
export function useHasPredicted(tradeWallet: Address | undefined, session: SessionDetail): boolean {
  const tokens = session.options.flatMap((option) =>
    [option.upToken, option.downToken, option.invalidToken].filter((token): token is Address => Boolean(token)),
  );
  const balances = useTokenBalances(tradeWallet, tokens);
  return balances.data?.some((balance) => balance > 0n) ?? false;
}

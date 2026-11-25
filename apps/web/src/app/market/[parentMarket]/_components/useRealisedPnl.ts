"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";

import { fetchRealisedPnl } from "@/features/resolution/api/getRealisedPnl";
import type { ParentResolution } from "@/features/resolution/api/getSessionResolution";
import type { SessionKey } from "@/features/resolution/api/useSessionResolution";
import type { OptionRealisedPnl, RealisedPnl } from "@/features/resolution/utils/realisedPnl";

import { STALE_TIME } from "@/lib/query";
import { publicClient } from "@/lib/web3/public-client";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { WAITING_REREAD_MS } from "./useTradeWalletRedeem";

/** Whether the visitor paid for or was paid by the option. */
export const traded = (option: OptionRealisedPnl) =>
  option.cost !== 0n || (option.status === "settled" && option.payout !== 0n);

/**
 * The connected account's realised P&L in the session, read once the parent has resolved; undefined while unread,
 * on a failed read, and for an account that never traded in it.
 */
export function useRealisedPnl(
  session: SessionKey | undefined,
  parent: ParentResolution | Error | undefined,
): RealisedPnl | undefined {
  const { address } = useAccount();
  const resolved = parent !== undefined && !(parent instanceof Error) && parent.resolved;

  const { data } = useQuery({
    queryKey: [
      "realised-pnl",
      DEFAULT_CHAIN_ID,
      address?.toLowerCase(),
      session?.sessionFactory.toLowerCase(),
      session && String(session.sessionId),
    ],
    queryFn:
      address && session && resolved
        ? () =>
            fetchRealisedPnl(publicClient, {
              chainId: DEFAULT_CHAIN_ID,
              owner: address,
              sessionFactory: session.sessionFactory,
              sessionId: session.sessionId,
            })
        : skipToken,
    staleTime: STALE_TIME.balance,
    // a waiting option's figure arrives once its own market resolves
    refetchInterval: (query) => (query.state.data?.session.waiting.length ? WAITING_REREAD_MS : false),
  });
  return data && Object.values(data.options).some(traded) ? data : undefined;
}

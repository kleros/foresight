"use client";

import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getConnection, sendTransaction } from "@wagmi/core";
import { isAddressEqual } from "viem";
import { useAccount } from "wagmi";

import { fetchRedeemScope, fetchTradeWalletRedeem } from "@/features/resolution/api/getTradeWalletRedeem";
import type { SessionKey } from "@/features/resolution/api/useSessionResolution";
import type { RedeemPlan } from "@/features/resolution/redeem/plan";
import {
  assertTradeWalletBatchAllowed,
  UnlistedRedeemBatchError,
} from "@/features/resolution/redeem/tradeWalletBatchAllowed";
import { fundsKeyPrefix } from "@/features/trade-executor/api/getFunds";

import { errorToast } from "@/utils/toast";
import { FEE_ONLY_OUT_OF_FUNDS_COPY } from "@/utils/txErrorText";
import { wrapWithToast } from "@/utils/wrapWithToast";

import { STALE_TIME } from "@/lib/query";
import { publicClient } from "@/lib/web3/public-client";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

/** What the trade wallet can redeem changed after it was shown (oracle R6), so nothing is sent. */
export class RedeemPlanChangedError extends Error {
  constructor() {
    super("What your trade wallet can redeem changed. Check the list and press Redeem again.");
    this.name = "RedeemPlanChangedError";
  }
}

// loaded on first send, so rendering the page does not need the wallet configuration
const wagmiConfig = () => import("@/lib/web3/wagmi").then((module) => module.wagmiConfig);

const NOT_SENT_COPY = "Not sent: this redeem does not match what Foresight allows for your connected account.";
const NETWORK_COPY = "The network did not answer.";

/**
 * What the connected account's trade wallet can redeem in the session. Keyed under the funds prefix, so every run
 * that changes the trade wallet's balances rereads it.
 * @param session undefined until the parent has resolved.
 */
export function useTradeWalletRedeem(session: SessionKey | undefined) {
  const { address: connected, chainId } = useAccount();
  // read on and sent to DEFAULT_CHAIN_ID, as the trade wallet row is
  const owner = chainId === DEFAULT_CHAIN_ID ? connected : undefined;

  return useQuery({
    queryKey: [
      ...fundsKeyPrefix,
      DEFAULT_CHAIN_ID,
      owner,
      "redeem",
      session?.sessionFactory.toLowerCase(),
      session && String(session.sessionId),
    ],
    queryFn:
      owner && session
        ? () =>
            fetchTradeWalletRedeem(publicClient, {
              chainId: DEFAULT_CHAIN_ID,
              owner,
              sessionFactory: session.sessionFactory,
              sessionId: session.sessionId,
            })
        : skipToken,
    staleTime: STALE_TIME.balance,
  });
}

const samePlan = (shown: RedeemPlan, fresh: RedeemPlan) =>
  shown.tx !== null &&
  fresh.tx !== null &&
  isAddressEqual(shown.tx.to, fresh.tx.to) &&
  shown.tx.data === fresh.tx.data &&
  shown.payout === fresh.payout;

/**
 * Signs the batch of the plan shown when Redeem was pressed, then rereads balances and the list once the receipt is
 * in. Before the wallet opens, the plan is built again for the account connected then and must match the one shown
 * (R6), and its batch is decoded against the session's markets read on-chain (R8).
 */
export function useRedeemFromTradeWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ plan, session }: { plan: RedeemPlan; session: SessionKey }) => {
      const config = await wagmiConfig();
      const account = getConnection(config).address;
      if (!account) throw new RedeemPlanChangedError();
      const request = {
        chainId: DEFAULT_CHAIN_ID,
        sessionFactory: session.sessionFactory,
        sessionId: session.sessionId,
      };
      const [fresh, scope] = await Promise.all([
        fetchTradeWalletRedeem(publicClient, { ...request, owner: account }),
        fetchRedeemScope(publicClient, request),
      ]).catch((error: unknown) => {
        errorToast(NETWORK_COPY);
        throw error;
      });
      const signer = getConnection(config).address;
      if (!signer || !isAddressEqual(signer, account) || !samePlan(plan, fresh)) throw new RedeemPlanChangedError();
      const tx = fresh.tx!;
      assertTradeWalletBatchAllowed({ tx, chainId: DEFAULT_CHAIN_ID, account: signer, scope });
      return wrapWithToast(
        config,
        () => sendTransaction(config, { account: signer, to: tx.to, data: tx.data, chainId: DEFAULT_CHAIN_ID }),
        FEE_ONLY_OUT_OF_FUNDS_COPY,
      );
    },
    onError: (error) => {
      if (error instanceof UnlistedRedeemBatchError) errorToast(NOT_SENT_COPY);
      if (error instanceof RedeemPlanChangedError) errorToast(error.message);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: fundsKeyPrefix }),
  });
}

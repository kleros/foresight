"use client";

import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sendTransaction } from "@wagmi/core";
import { isAddressEqual, type Address } from "viem";
import { useAccount } from "wagmi";

import type { ParentResolution } from "@/features/resolution/api/getSessionResolution";
import { fetchTradeWalletRedeem, readTradeWalletRedeem } from "@/features/resolution/api/getTradeWalletRedeem";
import { readTradeWalletRedeemToOwner } from "@/features/resolution/api/getTradeWalletRedeemToOwner";
import type { SessionKey } from "@/features/resolution/api/useSessionResolution";
import { REDEEM_ALLOW_LIST } from "@/features/resolution/oracle/allowlist";
import { ownerPayBatchDepartures, withOwnerTransfer } from "@/features/resolution/redeem/payOwner";
import type { RedeemPlan } from "@/features/resolution/redeem/plan";
import { assertRedeemBatchAllowed, UnlistedRedeemError } from "@/features/resolution/redeem/tradeWalletBatchAllowed";
import { fundsKeyPrefix } from "@/features/trade-executor/api/getFunds";

import { errorToast } from "@/utils/toast";
import { FEE_ONLY_OUT_OF_FUNDS_COPY } from "@/utils/txErrorText";
import { wrapWithToast } from "@/utils/wrapWithToast";

import { STALE_TIME } from "@/lib/query";
import { executorAddress } from "@/lib/trade-executor/executor";
import { publicClient } from "@/lib/web3/public-client";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { tradeExecutorAbi, tradeExecutorFactoryAddress } from "@/config/contracts";

/** What the trade wallet can redeem changed after it was shown (oracle R6), so nothing is sent. */
export class RedeemPlanChangedError extends Error {
  constructor() {
    super("What your trade wallet can redeem changed. Check the list and press Redeem again.");
    this.name = "RedeemPlanChangedError";
  }
}

// loaded on first send: its module validates env, which rendering the page must not need
const loadWagmiConfig = () => import("@/lib/web3/wagmi").then((module) => module.wagmiConfig);

const READ_FAILED_COPY = "Could not read your trade wallet. Nothing was sent; try again.";
export const NOT_SENT_COPY = "Not sent: this redeem does not match what Foresight allows for your account.";

/** How often, in ms, the list is read again while an option the trade wallet holds waits for its child's result. */
export const WAITING_REREAD_MS = 30_000;

/** Under the funds prefix, so every run that invalidates the trade wallet's balances rereads the list too. */
const tradeWalletRedeemKey = (owner: Address | undefined, session: SessionKey | undefined) =>
  [
    ...fundsKeyPrefix,
    DEFAULT_CHAIN_ID,
    owner?.toLowerCase(),
    "redeem",
    session?.sessionFactory.toLowerCase(),
    session && String(session.sessionId),
  ] as const;

const request = (owner: Address, { sessionFactory, sessionId }: SessionKey) => ({
  chainId: DEFAULT_CHAIN_ID,
  owner,
  sessionFactory,
  sessionId,
});

/**
 * What the connected account's trade wallet can redeem in the session; read only once the parent has resolved.
 * `owner` is the account the plan was read for.
 */
export function useTradeWalletRedeem(session: SessionKey | undefined, parent: ParentResolution | Error | undefined) {
  const { address, chainId } = useAccount();
  // read on and sent to DEFAULT_CHAIN_ID, as the trade wallet row is; a chain with no allow-list offers no redeem
  const owner = chainId === DEFAULT_CHAIN_ID && REDEEM_ALLOW_LIST[DEFAULT_CHAIN_ID] ? address : undefined;
  const resolved = parent !== undefined && !(parent instanceof Error) && parent.resolved;

  const query = useQuery({
    queryKey: tradeWalletRedeemKey(owner, session),
    queryFn:
      owner && session && resolved ? () => fetchTradeWalletRedeem(publicClient, request(owner, session)) : skipToken,
    staleTime: STALE_TIME.balance,
    refetchInterval: (current) => (current.state.data?.waiting.length ? WAITING_REREAD_MS : false),
  });
  return { ...query, owner };
}

/** `owner()` of `owner`'s trade wallet, read on-chain while `enabled`; the pay-to-owner box shows it. */
export function useTradeWalletOwner(owner: Address | undefined, enabled: boolean) {
  const factory = tradeExecutorFactoryAddress(DEFAULT_CHAIN_ID);
  const tradeWallet = owner && factory ? executorAddress(factory, owner) : undefined;
  return useQuery({
    queryKey: ["trade-wallet-owner", DEFAULT_CHAIN_ID, tradeWallet?.toLowerCase()],
    queryFn:
      tradeWallet && enabled
        ? () => publicClient.readContract({ address: tradeWallet, abi: tradeExecutorAbi, functionName: "owner" })
        : skipToken,
    // the trade wallet's owner is immutable
    staleTime: Infinity,
  });
}

const samePlan = (shown: RedeemPlan, fresh: RedeemPlan) =>
  shown.tx !== null &&
  fresh.tx !== null &&
  isAddressEqual(shown.tx.to, fresh.tx.to) &&
  shown.tx.data === fresh.tx.data &&
  shown.payout === fresh.payout &&
  shown.parts.length === fresh.parts.length &&
  shown.parts.every(
    (part, index) =>
      isAddressEqual(part.market, fresh.parts[index]!.market) && part.payout === fresh.parts[index]!.payout,
  );

export interface RedeemRunArgs {
  shown: RedeemPlan;
  owner: Address;
  session: SessionKey;
  /** The trade wallet's `owner()` shown beside the ticked pay-to-owner box; absent while unticked. */
  payTo?: Address;
}

const readOrSay = <T>(read: Promise<T>) =>
  read.catch((error: unknown) => {
    errorToast(READ_FAILED_COPY);
    throw error;
  });

/** The unticked batch, read again: the shown one (R6), kept to the allow-list (R8). */
async function intoTradeWallet({ shown, owner, session }: RedeemRunArgs) {
  const { plan, scope } = await readOrSay(readTradeWalletRedeem(publicClient, request(owner, session)));
  if (!samePlan(shown, plan)) throw new RedeemPlanChangedError();
  assertRedeemBatchAllowed({ tx: plan.tx!, chainId: DEFAULT_CHAIN_ID, account: owner, scope });
  return plan.tx!;
}

/** The ticked batch, read again: the shown one paid to the shown owner (R6), kept to R2 to R5 (R8). */
async function toOwner({ shown, owner, session }: RedeemRunArgs, payTo: Address) {
  const { plan, scope, payout } = await readOrSay(readTradeWalletRedeemToOwner(publicClient, request(owner, session)));
  // the expected batch's transfer names `payTo`, so another owner on-chain fails the comparison
  if (!samePlan(withOwnerTransfer(shown, scope.collateral, payTo), plan)) throw new RedeemPlanChangedError();
  const departures = ownerPayBatchDepartures({
    tx: plan.tx!,
    chainId: DEFAULT_CHAIN_ID,
    account: owner,
    scope,
    payout,
  });
  if (departures.length > 0) throw new UnlistedRedeemError(departures);
  return plan.tx!;
}

/**
 * Sends the shown plan's batch from `owner` only if a fresh read plans the same calls and payouts (R6) and the batch
 * keeps to the allow-list against the session's on-chain markets (R8); with `payTo`, the batch also pays the payout
 * to that owner. The list and balances are read again after.
 */
export function useRedeemFromTradeWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: RedeemRunArgs) => {
      const { owner } = args;
      const tx = args.payTo ? await toOwner(args, args.payTo) : await intoTradeWallet(args);
      const config = await loadWagmiConfig();
      return wrapWithToast(
        config,
        // wagmi refuses to send when the connected account or chain differs from these
        () => sendTransaction(config, { account: owner, chainId: DEFAULT_CHAIN_ID, to: tx.to, data: tx.data }),
        FEE_ONLY_OUT_OF_FUNDS_COPY,
      );
    },
    // wrapWithToast reports everything from the send on
    onError: (error) => {
      if (error instanceof RedeemPlanChangedError) errorToast(error.message);
      else if (error instanceof UnlistedRedeemError) errorToast(NOT_SENT_COPY);
    },
    // returned, so the run stays pending until the list is read again
    onSettled: () => queryClient.invalidateQueries({ queryKey: fundsKeyPrefix }),
  });
}

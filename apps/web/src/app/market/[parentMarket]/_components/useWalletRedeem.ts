"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { createViemTxGateway } from "@foresight/tx-orchestrator";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { getConnectorClient, sendTransaction } from "@wagmi/core";
import type { Address } from "viem";
import { useAccount } from "wagmi";

import type { ParentResolution } from "@/features/resolution/api/getSessionResolution";
import { fetchWalletRedeemInput } from "@/features/resolution/api/getWalletRedeem";
import type { SessionKey } from "@/features/resolution/api/useSessionResolution";
import { REDEEM_ALLOW_LIST } from "@/features/resolution/oracle/allowlist";
import { planWalletRedeem, type WalletRedeemInput, type WalletRedeemPlan } from "@/features/resolution/redeem/plan";
import { createRedeemReader } from "@/features/resolution/redeem/reader";
import { createRedeemRun, type RedeemProgress, type RedeemRun } from "@/features/resolution/redeem/run";
import { redeemRunStore } from "@/features/resolution/redeem/store";

import { STALE_TIME } from "@/lib/query";
import { publicClient } from "@/lib/web3/public-client";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { WAITING_REREAD_MS } from "./useTradeWalletRedeem";

// loaded on first send: the config reads the app's environment, which a page render does not need
const wagmiConfig = () => import("@/lib/web3/wagmi").then((module) => module.wagmiConfig);

/** Every read of what a connected wallet can redeem; a run that changes the wallet's tokens rereads it. */
export const walletRedeemKeyPrefix = ["wallet-redeem"] as const;

const walletRedeemKey = (owner: Address | undefined, session: SessionKey | undefined) =>
  [
    ...walletRedeemKeyPrefix,
    DEFAULT_CHAIN_ID,
    owner?.toLowerCase(),
    session?.sessionFactory.toLowerCase(),
    session && String(session.sessionId),
  ] as const;

/** One stored redeem run per session and account. */
export const walletRedeemFlowId = (session: SessionKey, owner: Address) =>
  `redeem:${session.sessionFactory.toLowerCase()}:${session.sessionId}:${owner.toLowerCase()}`;

/** The connected account, when it is on the chain redeem is read on and sent to. */
function useRedeemOwner(): Address | undefined {
  const { address, chainId } = useAccount();
  return chainId === DEFAULT_CHAIN_ID && REDEEM_ALLOW_LIST[DEFAULT_CHAIN_ID] ? address : undefined;
}

export interface WalletRedeemRead {
  /** What the plan was made from, which a run signs. */
  input: WalletRedeemInput;
  plan: WalletRedeemPlan;
}

/** What the connected wallet itself can redeem in the session; read only once the parent has resolved. */
export function useWalletRedeem(session: SessionKey | undefined, parent: ParentResolution | Error | undefined) {
  const owner = useRedeemOwner();
  const resolved = parent !== undefined && !(parent instanceof Error) && parent.resolved;

  const query = useQuery({
    queryKey: walletRedeemKey(owner, session),
    queryFn:
      owner && session && resolved
        ? async (): Promise<WalletRedeemRead> => {
            const input = await fetchWalletRedeemInput(publicClient, {
              chainId: DEFAULT_CHAIN_ID,
              owner,
              sessionFactory: session.sessionFactory,
              sessionId: session.sessionId,
            });
            return { input, plan: planWalletRedeem(input) };
          }
        : skipToken,
    staleTime: STALE_TIME.balance,
    refetchInterval: (current) => (current.state.data?.plan.waiting.length ? WAITING_REREAD_MS : false),
  });
  return { ...query, owner };
}

export interface WalletRedeemRunHandle {
  progress: RedeemProgress | null;
  /** Signs `input`, which is what the section showed when Redeem was pressed. */
  start: (input: WalletRedeemInput) => void;
  resume: () => void;
  retry: () => void;
  reset: () => void;
  discard: () => void;
  /** Waiting on the wallet or the chain. */
  isRunning: boolean;
}

/** One redeem run at a time from the connected wallet on this session, sent through the flow runner. */
export function useWalletRedeemRun(session: SessionKey | undefined): WalletRedeemRunHandle {
  const { address, chainId } = useAccount();
  const queryClient = useQueryClient();
  const account = useRef(address);
  account.current = address;
  const chain = useRef(chainId);
  chain.current = chainId;
  const request = useRef<WalletRedeemInput | undefined>(undefined);
  const factory = session?.sessionFactory;
  const sessionId = session?.sessionId;

  const [driver, setDriver] = useState<RedeemRun | null>(null);

  // built here, not in render, so a StrictMode replay disposes only the driver its own run created
  useEffect(() => {
    if (!address || factory === undefined || sessionId === undefined || !REDEEM_ALLOW_LIST[DEFAULT_CHAIN_ID]) return;
    const owner = address;
    const next = createRedeemRun({
      gateway: createViemTxGateway({
        client: publicClient,
        sendTransaction: async (tx) =>
          sendTransaction(await wagmiConfig(), { account: owner, chainId: DEFAULT_CHAIN_ID, ...tx }),
      }),
      wallet: {
        request: async (args) =>
          (await getConnectorClient(await wagmiConfig(), { account: owner, chainId: DEFAULT_CHAIN_ID })).request(
            args as never,
          ),
      },
      reader: createRedeemReader(publicClient),
      store: redeemRunStore(),
      flowId: walletRedeemFlowId({ sessionFactory: factory, sessionId }, owner),
      account: () => account.current,
      chainId: () => chain.current ?? 0,
      request: () => {
        if (!request.current) throw new Error("Nothing was reviewed to sign.");
        return request.current;
      },
    });
    setDriver(next);
    // a run stored by an earlier visit shows for review rather than waiting for the next press to take its place
    next.recover();
    return () => {
      next.dispose();
      setDriver(null);
    };
  }, [address, factory, sessionId]);

  const progress = useSyncExternalStore(
    (listener) => driver?.subscribe(listener) ?? (() => {}),
    () => driver?.getProgress() ?? null,
    () => driver?.getProgress() ?? null,
  );

  const stage = progress?.stage;
  useEffect(() => {
    // a halted run may have redeemed parts before it stopped
    if (stage === "complete" || stage === "halted") {
      void queryClient.invalidateQueries({ queryKey: walletRedeemKeyPrefix });
    }
  }, [stage, queryClient]);

  return {
    progress,
    start: (input) => {
      request.current = input;
      driver?.start();
    },
    resume: () => driver?.resume(),
    retry: () => driver?.retry(),
    reset: () => driver?.reset(),
    discard: () => void driver?.discard(),
    isRunning: stage === "signing" || stage === "confirming",
  };
}

"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { createViemTxGateway } from "@foresight/tx-orchestrator";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { getConnectorClient, sendTransaction } from "@wagmi/core";
import type { Address } from "viem";
import { useAccount } from "wagmi";

import { liquidityKeyPrefix } from "@/features/liquidity/api/getLiquidityPools";
import type { ParentResolution } from "@/features/resolution/api/getSessionResolution";
import { fetchWalletRedeemInput } from "@/features/resolution/api/getWalletRedeem";
import type { SessionKey } from "@/features/resolution/api/useSessionResolution";
import { REDEEM_ALLOW_LIST } from "@/features/resolution/oracle/allowlist";
import { planWalletRedeem, type WalletRedeemInput } from "@/features/resolution/redeem/plan";
import {
  createRedeemRun,
  unsettledRedeemRun,
  type RedeemProgress,
  type RedeemRun,
} from "@/features/resolution/redeem/run";

import { createRunStore } from "@/lib/flowRunStore";
import { STALE_TIME } from "@/lib/query";
import { publicClient } from "@/lib/web3/public-client";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { createRedeemReader } from "./redeemReader";
import { WAITING_REREAD_MS } from "./useTradeWalletRedeem";

// loaded on first send: its module validates env, which rendering the page must not need
const wagmiConfig = () => import("@/lib/web3/wagmi").then((module) => module.wagmiConfig);

/** Every query of what the connected wallet can redeem; a liquidity run that lands rereads it. */
export const walletRedeemKeyPrefix = ["wallet-redeem"] as const;

const walletRedeemKey = (owner: Address | undefined, session: SessionKey | undefined) =>
  [
    ...walletRedeemKeyPrefix,
    DEFAULT_CHAIN_ID,
    owner?.toLowerCase(),
    session?.sessionFactory.toLowerCase(),
    session && String(session.sessionId),
  ] as const;

/**
 * What the connected wallet itself holds and can redeem in the session, with its plan; read only once the parent has
 * resolved. `owner` is the account it was read for.
 */
export function useWalletRedeem(session: SessionKey | undefined, parent: ParentResolution | Error | undefined) {
  const { address, chainId } = useAccount();
  // a chain with no allow-list offers no redeem
  const owner = chainId === DEFAULT_CHAIN_ID && REDEEM_ALLOW_LIST[DEFAULT_CHAIN_ID] ? address : undefined;
  const resolved = parent !== undefined && !(parent instanceof Error) && parent.resolved;

  const query = useQuery({
    queryKey: walletRedeemKey(owner, session),
    queryFn:
      owner && session && resolved
        ? async () => {
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

export interface WalletRedeemRun {
  progress: RedeemProgress | null;
  /** Signs `input`, which is what the section showed when Redeem was pressed. */
  start: (input: WalletRedeemInput) => void;
  resume: () => void;
  retry: () => void;
  /** Lets go of a stopped run's sends that cannot land; for after the user confirmed Start over. */
  discard: () => void;
}

/** One connected wallet redeem at a time for `owner` on the session, recovered from this browser on mount. */
export function useWalletRedeemRun(owner: Address | undefined, session: SessionKey | undefined): WalletRedeemRun {
  const { address, chainId } = useAccount();
  const queryClient = useQueryClient();
  const account = useRef(address);
  account.current = address;
  const chain = useRef(chainId);
  chain.current = chainId;
  const request = useRef<WalletRedeemInput | undefined>(undefined);
  const [driver, setDriver] = useState<RedeemRun | null>(null);
  const factory = session?.sessionFactory.toLowerCase();
  const sessionId = session && String(session.sessionId);

  // built here, not in render, so a StrictMode replay disposes only the driver its own run created
  useEffect(() => {
    if (!owner || !factory || !sessionId) return;
    const from = owner;
    const next = createRedeemRun({
      gateway: createViemTxGateway({
        client: publicClient,
        sendTransaction: async (tx) =>
          sendTransaction(await wagmiConfig(), { account: from, chainId: DEFAULT_CHAIN_ID, ...tx }),
      }),
      wallet: {
        request: async (args) =>
          (await getConnectorClient(await wagmiConfig(), { account: from, chainId: DEFAULT_CHAIN_ID })).request(
            args as never,
          ),
      },
      reader: createRedeemReader(publicClient),
      store: createRunStore(unsettledRedeemRun),
      flowId: `redeem:${factory}:${sessionId}:${from.toLowerCase()}`,
      account: () => account.current,
      chainId: () => chain.current ?? 0,
      request: () => {
        if (!request.current) throw new Error("Nothing was reviewed to sign.");
        return request.current;
      },
    });
    setDriver(next);
    // a run stored by an earlier visit shows for review rather than waiting for the next press
    next.recover();
    return () => {
      next.dispose();
      setDriver(null);
    };
  }, [owner, factory, sessionId]);

  const progress = useSyncExternalStore(
    (listener) => driver?.subscribe(listener) ?? (() => {}),
    () => driver?.getProgress() ?? null,
    () => driver?.getProgress() ?? null,
  );

  const stage = progress?.stage;
  useEffect(() => {
    // a halted run may have landed sends before it stopped
    if (stage === "complete" || stage === "halted") {
      void queryClient.invalidateQueries({ queryKey: walletRedeemKeyPrefix });
      void queryClient.invalidateQueries({ queryKey: liquidityKeyPrefix });
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
    discard: () => void driver?.discard(),
  };
}

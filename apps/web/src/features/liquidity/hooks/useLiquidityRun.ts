"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { createViemTxGateway } from "@foresight/tx-orchestrator";
import { useQueryClient } from "@tanstack/react-query";
import { getConnectorClient, sendTransaction } from "@wagmi/core";
import type { Address } from "viem";
import { useAccount } from "wagmi";

import { publicClient } from "@/lib/web3/public-client";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { liquidityKeyPrefix } from "../api/getLiquidityPools";
import { LIQUIDITY_ALLOW_LIST } from "../oracle/allowlist";
import { createLiquidityRun, type LiquidityDriver } from "../run/driver";
import { createLiquidityReader } from "../run/reader";
import { liquidityRunStore } from "../run/store";
import type { LiquidityProgress, LiquidityRequest } from "../types";

/** A session with no close is never closed to adds. */
const NO_CLOSE = 2n ** 64n;

// loaded on first send: the config reads the app's environment, which a page render does not need
const wagmiConfig = () => import("@/lib/web3/wagmi").then((module) => module.wagmiConfig);

export interface LiquidityRun {
  progress: LiquidityProgress | null;
  /** Signs `request`, which is what the popup or the section showed when it was pressed. */
  start: (request: LiquidityRequest) => void;
  resume: () => void;
  retry: () => void;
  /** Forgets a stopped run; what it already signed stays done. */
  reset: () => void;
  /** Lets go of a stopped run's unsettled sends, keeping its settled steps; called only once the user confirmed. */
  discard: () => void;
  /** Waiting on the wallet or the chain. */
  isRunning: boolean;
  /** A run holds this session's slot: running, or stopped until it is resumed, retried or reset. */
  isHeld: boolean;
}

/** One liquidity run at a time for the connected account on this session: seed, add, remove or merge. */
export function useLiquidityRun(parentMarket: Address, closesAt: Date | null): LiquidityRun {
  const { address, chainId } = useAccount();
  const queryClient = useQueryClient();
  const account = useRef(address);
  account.current = address;
  const chain = useRef(chainId);
  chain.current = chainId;
  const request = useRef<LiquidityRequest | undefined>(undefined);
  const closes = closesAt ? BigInt(closesAt.getTime()) / 1000n : NO_CLOSE;

  const [driver, setDriver] = useState<LiquidityDriver | null>(null);

  // built here, not in render, so a StrictMode replay disposes only the driver its own run created
  useEffect(() => {
    // the local chain has no allow list, so nothing there is ever signed
    if (!address || !LIQUIDITY_ALLOW_LIST[DEFAULT_CHAIN_ID]) return;
    const owner = address;
    const next = createLiquidityRun({
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
      reader: createLiquidityReader(publicClient, DEFAULT_CHAIN_ID),
      store: liquidityRunStore(),
      flowId: `liquidity:${parentMarket.toLowerCase()}:${owner.toLowerCase()}`,
      account: () => account.current,
      chainId: () => chain.current ?? 0,
      request: () => {
        if (!request.current) throw new Error("Nothing was reviewed to sign.");
        return request.current;
      },
      closesAt: closes,
    });
    setDriver(next);
    // a run stored by an earlier visit shows for review rather than waiting for the next press to take its place
    next.recover();
    return () => {
      next.dispose();
      setDriver(null);
    };
  }, [address, parentMarket, closes]);

  const progress = useSyncExternalStore(
    (listener) => driver?.subscribe(listener) ?? (() => {}),
    () => driver?.getProgress() ?? null,
    () => driver?.getProgress() ?? null,
  );

  const stage = progress?.stage;
  useEffect(() => {
    if (stage === "complete" || stage === "moved") void queryClient.invalidateQueries({ queryKey: liquidityKeyPrefix });
  }, [stage, queryClient]);

  return {
    progress,
    start: (next) => {
      if (!driver) return;
      request.current = next;
      // a stopped run is carried on or reset explicitly, so what it already signed is not signed again
      if (driver.getProgress().stage === "complete") driver.reset();
      driver.start();
    },
    resume: () => driver?.resume(),
    retry: () => driver?.retry(),
    reset: () => driver?.reset(),
    discard: () => void driver?.discard(),
    isRunning: stage === "signing" || stage === "confirming",
    isHeld: stage !== undefined && stage !== "idle" && stage !== "complete",
  };
}

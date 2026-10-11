"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { createViemTxGateway, type FlowRunStore } from "@foresight/tx-orchestrator";
import { sendTransaction } from "@wagmi/core";
import type { Address } from "viem";

import { createRunStore } from "@/lib/flowRunStore";
import { createLensQuoter } from "@/lib/swap/lens";
import { publicClient } from "@/lib/web3/public-client";
import { wagmiConfig } from "@/lib/web3/wagmi";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import type { PredictCtx, PredictOption, PredictSnapshot } from "../flow/types";
import { createPredictRun } from "../run/driver";
import { createPredictReader } from "../run/reader";
import type { PredictDriver, PredictProgress } from "../run/types";

/** Hundredths of a percent. Seer's own default, and what a thin outcome pool needs. */
const SLIPPAGE_BPS = 100;

export interface PredictRunInput {
  sessionId: string;
  parentMarket: Address;
  collateral: Address;
  /** Seer's router on this chain; without one there is nothing to split or merge with. */
  router: Address;
  factory: Address;
  owner: Address;
  executor: Address;
  /** Null where the chain cannot turn xDAI into the session's collateral. */
  sDaiAdapter: Address | null;
  /** What the visitor set, already turned into target prices. */
  options: () => PredictOption[];
  /** What has to be added to the trade wallet, in the token the visitor chose. */
  deposit: () => bigint;
  depositNative: () => boolean;
  /** Collateral the prediction splits: what the trade wallet holds plus what is added. */
  collateralIn: () => bigint;
  /** What the trade wallet held when the visitor pressed predict. */
  collateralBefore: () => bigint;
  onComplete?: () => void;
}

export function usePredictRun(input: PredictRunInput | null): {
  driver: PredictDriver | null;
  progress: PredictProgress | null;
} {
  /**
   * The last input that was complete. A wallet leaving the chain mid-run makes the caller's
   * input null; holding the previous one keeps the driver, and with it the progress of a
   * transaction already on chain, rather than disposing it and losing the record.
   */
  const latest = useRef(input);
  if (input) latest.current = input;

  const storeRef = useRef<FlowRunStore | undefined>(undefined);
  storeRef.current ??= createRunStore();

  // Only a different session or a different owner is a different run. Everything else is read
  // through the ref when the button is pressed.
  const held = latest.current;
  const identity = held && [held.sessionId, held.owner].join("-");

  const driver = useMemo<PredictDriver | null>(() => {
    if (!identity || !held) return null;
    const input = held;

    return createPredictRun({
      gateway: createViemTxGateway({
        client: publicClient,
        sendTransaction: (tx) => sendTransaction(wagmiConfig, { to: tx.to, data: tx.data, value: tx.value }),
      }),
      reader: createPredictReader({
        client: publicClient,
        sessionId: input.sessionId,
        collateral: input.collateral,
      }),
      quoter: createLensQuoter(publicClient, DEFAULT_CHAIN_ID as 100),
      store: storeRef.current,
      slippageBps: SLIPPAGE_BPS,
      flowId: `predict-${input.sessionId}`,
      ctx: (): PredictCtx => {
        const now = latest.current;
        if (!now) throw new Error("This session is no longer open for predictions.");
        return {
          chainId: DEFAULT_CHAIN_ID,
          owner: now.owner,
          executor: now.executor,
          factory: now.factory,
          router: now.router,
          collateral: now.collateral,
          parentMarket: now.parentMarket,
          sDaiAdapter: now.sDaiAdapter,
        };
      },
      snapshot: (): PredictSnapshot => {
        const now = latest.current;
        if (!now) throw new Error("This session is no longer open for predictions.");
        return {
          options: now.options(),
          deposit: now.deposit(),
          depositNative: now.depositNative(),
          // An xDAI deposit's collateral is read back once it lands; this is the estimate until then.
          collateralIn: now.collateralIn(),
          collateralBefore: now.collateralBefore(),
          startedAt: Math.floor(Date.now() / 1000),
        };
      },
      onComplete: () => latest.current?.onComplete?.(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt on identity, read through the ref otherwise
  }, [identity]);

  useEffect(() => () => driver?.dispose(), [driver]);

  const progress = useSyncExternalStore(
    (cb) => driver?.subscribe(cb) ?? (() => {}),
    () => driver?.getProgress() ?? null,
    () => driver?.getProgress() ?? null,
  );

  return { driver, progress };
}

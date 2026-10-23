"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { createViemTxGateway, type FlowRunStore } from "@foresight/tx-orchestrator";
import { sendTransaction } from "@wagmi/core";
import type { Address } from "viem";

import { createRunStore } from "@/lib/flowRunStore";
import { createLensExactInputQuoter, createLensQuoter } from "@/lib/swap/lens";
import { publicClient } from "@/lib/web3/public-client";
import { wagmiConfig } from "@/lib/web3/wagmi";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import type { CreditsRoute } from "@/config/contracts";

import type { PredictCtx, PredictOption, PredictRequest, PredictSlippage } from "../flow/types";
import { createPredictRun, type OptionTokens } from "../run/driver";
import { predictFlowId } from "../run/interrupted";
import { tabOwnership } from "../run/ownership";
import { createPredictReader } from "../run/reader";
import type { PredictDriver, PredictProgress } from "../run/types";

export interface PredictRunInput {
  sessionId: string;
  /** When the session stops trading, in unix seconds; null for a session with no close. */
  closesAt: number | null;
  parentMarket: Address;
  collateral: Address;
  /** Seer's router on this chain; without one there is nothing to split or merge with. */
  router: Address;
  factory: Address;
  owner: Address;
  executor: Address;
  /** Null where the chain cannot turn xDAI into the session's collateral. */
  sDaiAdapter: Address | null;
  /** Null where credits cannot fund the session's collateral. */
  credits: CreditsRoute | null;
  /** What the visitor set, already turned into target prices. */
  options: () => PredictOption[];
  /** Every option of the session with its tokens, which a stored run is checked against. */
  sessionOptions: () => readonly OptionTokens[];
  /**
   * The money the popup shows, read when Predict is pressed. An xDAI deposit's collateral is read
   * back once it lands; `collateralIn` is the estimate until then.
   */
  funding: () => Omit<PredictRequest, "options" | "startedAt" | "slippage">;
  /** The popup's slippage settings, read when Predict is pressed. */
  slippage: () => PredictSlippage;
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
  const store = (storeRef.current ??= createRunStore());

  // Only a different session or a different owner is a different run. Everything else is read
  // through the ref when the button is pressed.
  const held = latest.current;
  const identity = held && [held.sessionId, held.owner].join("-");

  const driver = useMemo<PredictDriver | null>(() => {
    if (!identity || !held) return null;
    const input = held;
    const flowId = predictFlowId(input.sessionId, input.owner);

    return createPredictRun({
      gateway: createViemTxGateway({
        client: publicClient,
        // wagmi refuses to send when the connected account or chain differs from these.
        sendTransaction: (tx) =>
          sendTransaction(wagmiConfig, {
            account: input.owner,
            chainId: DEFAULT_CHAIN_ID,
            to: tx.to,
            data: tx.data,
            value: tx.value,
          }),
      }),
      reader: createPredictReader({
        client: publicClient,
        sessionId: input.sessionId,
        collateral: input.collateral,
        credits: input.credits,
      }),
      quoter: createLensQuoter(publicClient, DEFAULT_CHAIN_ID as 100),
      creditsQuoter: createLensExactInputQuoter(publicClient, DEFAULT_CHAIN_ID as 100),
      store,
      flowId,
      ownership: tabOwnership(),
      closesAt: input.closesAt,
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
          credits: now.credits,
        };
      },
      snapshot: (): PredictRequest => {
        const now = latest.current;
        if (!now) throw new Error("This session is no longer open for predictions.");
        return {
          options: now.options(),
          ...now.funding(),
          slippage: now.slippage(),
          startedAt: Math.floor(Date.now() / 1000),
        };
      },
      slippage: () => latest.current?.slippage(),
      sessionOptions: () => {
        const now = latest.current;
        if (!now) throw new Error("This session is no longer open for predictions.");
        return now.sessionOptions();
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

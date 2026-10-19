"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

import type { PriceMove } from "@/features/predict/components/PredictList";
import { createPredictReader } from "@/features/predict/run/reader";
import type { ShownPlans } from "@/features/predict/run/types";
import type { SelectedEstimate } from "@/features/predict/types";
import { previewTrades, type PreviewTrades } from "@/features/predict/utils/plan";
import type { SessionDetail } from "@/features/sessions/types";

import { priceWadToEstimate } from "@/utils/optionPrice";

import { publicClient } from "@/lib/web3/public-client";

import { toPredictOptions } from "./toPredictOptions";

export interface PricePreview {
  /** Where each option's market would move and with which trades, keyed by lower-case market. */
  moves: Record<string, PriceMove>;
  /** Each option's plan as the pool maths gives it, which Predict holds the run to. */
  plans: ShownPlans;
  /** Underlying each option's trade wallet already holds, keyed as `plans`. */
  held: Record<string, bigint>;
}

/** An option's plan as the summary shows it, in the option's unit; `held` counts only where the plan splits. */
export function toPriceMove(trades: PreviewTrades, scale: SessionDetail["options"][number], held: bigint): PriceMove {
  const { from, to, ...plan } = trades;
  return {
    from: priceWadToEstimate(from, scale),
    to: priceWadToEstimate(to, scale),
    plan: { ...plan, held: plan.split > 0n ? held : 0n },
  };
}

/** Where each selected option's market sits now, where this prediction would move it and with which trades. */
export function usePricePreview(args: {
  session: SessionDetail;
  selected: SelectedEstimate[];
  /** The owner's trade wallet, whose held tokens the trades start from. */
  tradeWallet: Address | undefined;
  /** Collateral the prediction splits. */
  collateralIn: bigint;
  /** The trades' slippage setting, which sizes the buys. */
  slippageBps: number;
}): PricePreview {
  const { session, selected, tradeWallet, collateralIn, slippageBps } = args;
  const { collateralToken } = session;
  const options = toPredictOptions(session, selected);

  const states = useQuery({
    queryKey: [
      "predict-preview",
      session.id,
      tradeWallet,
      options.map((option) => `${option.childMarket}:${option.targetPriceWad}`),
    ],
    queryFn: () =>
      createPredictReader({ client: publicClient, sessionId: session.id, collateral: collateralToken! }).optionStates({
        options,
        executor: tradeWallet!,
      }),
    enabled: tradeWallet !== undefined && collateralToken !== null && options.length > 0,
  });

  const preview: PricePreview = { moves: {}, plans: {}, held: {} };
  const plans: Record<string, PreviewTrades> = {};
  for (const [index, option] of options.entries()) {
    const state = states.data?.[index];
    const scale = session.options.find((each) => each.market === option.childMarket);
    if (!state || !scale) continue;

    const trades = previewTrades(
      {
        pools: state.pools,
        targetPriceWad: option.targetPriceWad,
        held: state.held,
        splitAmount: state.underlying + collateralIn,
      },
      slippageBps,
    );
    if (trades) {
      const key = option.childMarket.toLowerCase();
      plans[key] = trades;
      preview.held[key] = state.underlying;
      preview.moves[key] = toPriceMove(trades, scale, state.underlying);
    }
  }
  return { ...preview, plans };
}

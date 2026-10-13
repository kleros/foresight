"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

import type { PriceMove } from "@/features/predict/components/PredictList";
import { SLIPPAGE_BPS } from "@/features/predict/oracle/tolerances";
import { createPredictReader } from "@/features/predict/run/reader";
import type { SelectedEstimate } from "@/features/predict/types";
import { previewUpPrice } from "@/features/predict/utils/plan";
import type { SessionDetail } from "@/features/sessions/types";

import { priceWadToEstimate } from "@/utils/optionPrice";

import { publicClient } from "@/lib/web3/public-client";

import { toPredictOptions } from "./toPredictOptions";

/** Where each selected option's market sits now and where this prediction would move it, keyed by lower-case market. */
export function usePricePreview(args: {
  session: SessionDetail;
  selected: SelectedEstimate[];
  /** The owner's trade wallet, whose held tokens the trades start from. */
  tradeWallet: Address | undefined;
  /** Collateral the prediction splits. */
  collateralIn: bigint;
}): Record<string, PriceMove> {
  const { session, selected, tradeWallet, collateralIn } = args;
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

  const preview: Record<string, PriceMove> = {};
  for (const [index, option] of options.entries()) {
    const state = states.data?.[index];
    const scale = session.options.find((each) => each.market === option.childMarket);
    if (!state || !scale) continue;

    const move = previewUpPrice(
      {
        pools: state.pools,
        targetPriceWad: option.targetPriceWad,
        held: state.held,
        splitAmount: state.underlying + collateralIn,
      },
      SLIPPAGE_BPS,
    );
    if (move) {
      preview[option.childMarket.toLowerCase()] = {
        from: priceWadToEstimate(move.from, scale),
        to: priceWadToEstimate(move.to, scale),
      };
    }
  }
  return preview;
}

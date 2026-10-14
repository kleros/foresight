import type { FlowHooks, TxStep } from "@foresight/tx-orchestrator";
import type { Address } from "viem";

import { NoSwapRouteError, type SwapQuote, type SwapQuoter, type SwapQuoteRequest } from "@/lib/swap/types";
import { batchExecuteTx, createExecutorTx, type ExecutorCall } from "@/lib/trade-executor/executor";
import { depositNativeTx, depositTx } from "@/lib/trade-executor/funding";
import { splitCalls } from "@/lib/trade-executor/positions";
import { optionTradeCalls, type QuotedSwap } from "@/lib/trade-executor/predict";

import type {
  OptionChainState,
  PredictCtx,
  PredictOption,
  PredictReader,
  PredictRequest,
  PredictSnapshot,
} from "./types";
import { SLIPPAGE_BPS } from "../oracle/tolerances";
import { planBuys, planSells, type OptionSide, type SoldLeg } from "../utils/plan";

/**
 * The predict-flow adapter: set up the trade wallet, add money, then move the pools toward the
 * visitor's estimates. The trades are quoted inside `build`, which the orchestrator runs afresh
 * on every attempt, so a retry or a resume prices against the pools as they are then.
 */

type Step = TxStep<PredictSnapshot, PredictCtx>;

export const STEP_ID = {
  createExecutor: "create-wallet",
  deposit: "deposit",
  predict: (batch: number) => `predict-${batch}`,
} as const;

/** Options per transaction. Movies-r3's default, and like it, unmeasured against real Seer gas. */
export const PREDICT_BATCH_SIZE = 10;

export interface PredictDeps {
  reader: PredictReader;
  quoter: SwapQuoter;
  /** Hundredths of a percent a quote may move against the executor before the swap reverts. */
  slippageBps?: number;
  optionsPerBatch?: number;
  /** Told about an option no route could be found for, which the batch leaves out. */
  onSkip?: (option: PredictOption, reason: unknown) => void;
}

const outcomeToken = (option: PredictOption, side: OptionSide): Address =>
  side === "up" ? option.upToken : option.downToken;

/** Nothing in the batch can move a pool toward its estimate; trying again with the same input will not help. */
export class NoRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoRouteError";
  }
}

/** The quoter gave no answer, so whether a route exists is unknown; trying again may help. */
export class QuoteFailedError extends Error {
  constructor(options: ErrorOptions) {
    super("The quoter could not be asked for a price.", options);
    this.name = "QuoteFailedError";
  }
}

/** The run is set up so that it cannot succeed; trying again with the same input fails the same way. */
export class PredictConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PredictConfigError";
  }
}

async function quoteLeg(deps: PredictDeps, request: SwapQuoteRequest): Promise<SwapQuote> {
  try {
    return await deps.quoter.quote(request);
  } catch (error) {
    if (error instanceof NoSwapRouteError) throw error;
    throw new QuoteFailedError({ cause: error });
  }
}

function batched<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

/**
 * One option's trades. The sells are quoted before the buys are sized, because what a sell pays
 * is what the buys have to spend, less what the slippage setting lets a sell fall short by.
 */
async function optionCalls(
  ctx: PredictCtx,
  option: PredictOption,
  state: OptionChainState,
  mint: bigint,
  deps: PredictDeps,
): Promise<ExecutorCall[]> {
  const splitAmount = state.underlying + mint;
  const slippageBps = deps.slippageBps ?? SLIPPAGE_BPS;
  const target = { pools: state.pools, targetPriceWad: option.targetPriceWad, held: state.held, splitAmount };

  const sells: QuotedSwap[] = [];
  const sold: SoldLeg[] = [];
  for (const leg of planSells(target)) {
    const tokenIn = outcomeToken(option, leg.side);
    const quote = await quoteLeg(deps, {
      tokenIn,
      tokenOut: option.underlying,
      amount: leg.amountIn,
      recipient: ctx.executor,
      slippageBps,
      limitSqrtPrice: leg.limitSqrtPrice,
      amountInAtLimit: leg.amountInAtLimit,
      amountOutAtLimit: leg.amountOutAtLimit,
    });
    sells.push({ tokenIn, quote });
    sold.push({ ...leg, underlyingOut: quote.amountOut });
  }

  const { mergeAmount, legs } = planBuys(target, sold, slippageBps);

  const buys: QuotedSwap[] = [];
  for (const leg of legs) {
    const quote = await quoteLeg(deps, {
      tokenIn: option.underlying,
      tokenOut: outcomeToken(option, leg.side),
      amount: leg.amountIn,
      recipient: ctx.executor,
      slippageBps,
      limitSqrtPrice: leg.limitSqrtPrice,
      amountInAtLimit: leg.amountInAtLimit,
      amountOutAtLimit: leg.amountOutAtLimit,
    });
    buys.push({ tokenIn: option.underlying, quote });
  }

  if (sells.length === 0 && buys.length === 0) {
    throw new Error(`No route moves ${option.childMarket} toward your estimate.`);
  }

  return optionTradeCalls({
    router: ctx.router,
    childMarket: option.childMarket,
    collateral: ctx.collateral,
    underlying: option.underlying,
    outcomeTokens: [option.downToken, option.upToken],
    invalidToken: option.invalidToken,
    splitAmount,
    sells,
    mergeAmount,
    buys,
  });
}

async function predictCalls(args: {
  ctx: PredictCtx;
  options: PredictOption[];
  /** Collateral to split at the parent, which gives every option its underlying. */
  mint: bigint;
  deps: PredictDeps;
}): Promise<ExecutorCall[]> {
  const { ctx, options, mint, deps } = args;
  const states = await deps.reader.optionStates({ options, executor: ctx.executor });

  const calls: ExecutorCall[] =
    mint > 0n
      ? splitCalls({ router: ctx.router, collateral: ctx.collateral, market: ctx.parentMarket, amount: mint })
      : [];

  let traded = 0;
  for (const [index, option] of options.entries()) {
    const state = states[index];
    if (state === undefined) continue;

    try {
      calls.push(...(await optionCalls(ctx, option, state, mint, deps)));
      traded += 1;
    } catch (reason) {
      if (reason instanceof QuoteFailedError) throw reason;
      deps.onSkip?.(option, reason);
    }
  }

  if (traded === 0) {
    throw new NoRouteError("No route was found for any of these estimates. Try again in a moment, or a larger amount.");
  }

  return calls;
}

/** The part of `collateralIn` the trade wallet already held, as the visitor was shown it. */
export function tradeWalletShare(snap: Pick<PredictSnapshot, "collateralIn" | "collateralBefore">): bigint {
  const shown = snap.collateralBefore;
  return snap.collateralIn < shown ? snap.collateralIn : shown;
}

/**
 * The executor balance that shows the deposit has landed. An xDAI deposit mints an amount only
 * the chain knows, so any rise over the starting balance counts.
 */
export function depositLandedAt(snap: PredictSnapshot): bigint {
  return snap.collateralAtStart + (snap.depositNative ? 1n : snap.deposit);
}

export function planPredict(snapshot: PredictRequest, deps: PredictDeps): Step[] {
  if (snapshot.options.length === 0) {
    throw new PredictConfigError("There are no estimates to predict.");
  }

  const steps: Step[] = [
    {
      id: STEP_ID.createExecutor,
      label: "Set up your trade wallet",
      canSkip: (ctx) => deps.reader.isExecutorDeployed(ctx.executor),
      build: (ctx) => createExecutorTx(ctx.factory),
    },
  ];

  if (snapshot.deposit > 0n) {
    steps.push({
      id: STEP_ID.deposit,
      label: "Add money to your trade wallet",
      // A tab that died with the wallet open leaves no hash to reconcile, so the balance is the
      // only witness that the money already moved. It cannot tell this deposit from an earlier
      // one, which is the safe way round: a skipped deposit spends nothing twice.
      canSkip: async (ctx, snap) => (await deps.reader.collateralBalance(ctx.executor)) >= depositLandedAt(snap),
      build: (ctx, snap) => {
        if (!snap.depositNative) {
          return depositTx({ executor: ctx.executor, asset: { token: ctx.collateral, amount: snap.deposit } });
        }
        if (ctx.sDaiAdapter === null) {
          throw new PredictConfigError("This network has no xDAI route into the trade wallet.");
        }
        return depositNativeTx({ executor: ctx.executor, sDaiAdapter: ctx.sDaiAdapter, amount: snap.deposit });
      },
    });
  }

  const batches = batched(snapshot.options, deps.optionsPerBatch ?? PREDICT_BATCH_SIZE);

  steps.push(
    ...batches.map((options, index): Step => {
      const optionIds = new Set(options.map((option) => option.childMarket));

      return {
        id: STEP_ID.predict(index + 1),
        label:
          batches.length === 1 ? "Making your prediction" : `Making your prediction, ${index + 1} of ${batches.length}`,
        // Only the first batch splits collateral: it hands every option its underlying at once.
        build: async (ctx, snap) =>
          batchExecuteTx(
            ctx.executor,
            await predictCalls({
              ctx,
              options: snap.options.filter((option) => optionIds.has(option.childMarket)),
              mint: index === 0 ? snap.collateralIn : 0n,
              deps,
            }),
          ),
      };
    }),
  );

  return steps;
}

/**
 * Quotes every batch without signing, so a run no route can follow stops before it adds money.
 * Each batch is priced as if the split had already handed every option its underlying.
 */
export async function assertRoutes(ctx: PredictCtx, snapshot: PredictSnapshot, deps: PredictDeps): Promise<void> {
  const quiet = { ...deps, onSkip: undefined };
  for (const options of batched(snapshot.options, deps.optionsPerBatch ?? PREDICT_BATCH_SIZE)) {
    await predictCalls({ ctx, options, mint: snapshot.collateralIn, deps: quiet });
  }
}

export function createPredictHooks(deps: Pick<PredictDeps, "reader">): FlowHooks<PredictSnapshot, PredictCtx> {
  return {
    async afterStep({ ctx, snapshot, completed }) {
      if (completed.stepId !== STEP_ID.deposit || !snapshot.depositNative) return;

      // The adapter mints whatever the xDAI was worth, which is only knowable once it lands.
      const minted = (await deps.reader.collateralBalance(ctx.executor)) - snapshot.collateralAtStart;
      return { snapshotPatch: { collateralIn: minted + tradeWalletShare(snapshot) } };
    },
  };
}

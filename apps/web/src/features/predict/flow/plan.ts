import type { FlowHooks, FlowTx, TxStep } from "@foresight/tx-orchestrator";
import { decodeFunctionData, encodeFunctionData, erc20Abi, isAddressEqual, type Address } from "viem";

import { ALGEBRA_ROUTER_ABI } from "@/lib/swap/algebraRouter";
import {
  NoSwapRouteError,
  type ExactInputQuoter,
  type SwapQuote,
  type SwapQuoter,
  type SwapQuoteRequest,
} from "@/lib/swap/types";
import {
  batchExecuteTx,
  batchValueExecuteTx,
  createExecutorTx,
  type ExecutorCall,
  type ExecutorValueCall,
} from "@/lib/trade-executor/executor";
import { depositNativeTx, depositTx } from "@/lib/trade-executor/funding";
import { splitCalls } from "@/lib/trade-executor/positions";
import { optionTradeCalls, type QuotedSwap } from "@/lib/trade-executor/predict";

import { creditsManagerAbi, gnosisRouterAbi, wxdaiAbi } from "@/config/contracts";

import { STEP_ID } from "./stepIds";
import type {
  OptionChainState,
  PredictCtx,
  PredictOption,
  PredictReader,
  PredictRequest,
  PredictSnapshot,
} from "./types";
import { CREDITS_MAX_LOSS_BPS, CREDITS_SLIPPAGE_BPS, SLIPPAGE_BPS } from "../oracle/tolerances";
import { planBuys, planSells, type OptionSide, type SoldLeg } from "../utils/plan";

/**
 * The predict-flow adapter: set up the trade wallet, add money, then move the pools toward the
 * visitor's estimates. The trades are quoted inside `build`, which the orchestrator runs afresh
 * on every attempt, so a retry or a resume prices against the pools as they are then.
 */

type Step = TxStep<PredictSnapshot, PredictCtx>;

export { STEP_ID };

/** Options per transaction. Movies-r3's default, and like it, unmeasured against real Seer gas. */
export const PREDICT_BATCH_SIZE = 10;

export interface PredictDeps {
  reader: PredictReader;
  quoter: SwapQuoter;
  /** Quotes the swap the credits manager makes; needed only by a run that spends credits. */
  creditsQuoter?: ExactInputQuoter;
  /** Hundredths of a percent a quote may move against the executor before the swap reverts. */
  slippageBps?: number;
  optionsPerBatch?: number;
  /** Told about an option no route could be found for, which the batch `stepId` leaves out. */
  onSkip?: (option: PredictOption, reason: unknown, stepId: string) => void;
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

/** The credits cannot be spent now: the manager is short, or its swap would lose too much or pay elsewhere. */
export class CreditsUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CreditsUnavailableError";
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
      poolFee: state.pools[leg.side].fee,
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
      poolFee: state.pools[leg.side].fee,
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

/** The credits leg of the first batch, and the collateral its xDAI mints at the parent. */
interface CreditsLeg {
  calls: ExecutorValueCall[];
  minted: bigint;
}

/**
 * The manager swaps `creditsToSpend` of its collateral for WXDAI paid to the executor, which unwraps
 * the floor and splits it at the parent as xDAI. The surplus over the floor stays as WXDAI.
 */
async function creditsLeg(ctx: PredictCtx, amount: bigint, deps: PredictDeps): Promise<CreditsLeg> {
  const route = ctx.credits;
  if (route === null) throw new PredictConfigError("Credits cannot fund this session on this network.");
  if (!deps.creditsQuoter) throw new PredictConfigError("There is no quoter for the credits swap.");
  if ((await deps.reader.managerCollateral()) < amount) {
    throw new CreditsUnavailableError("The credits manager cannot cover these credits right now.");
  }

  let quote;
  try {
    quote = await deps.creditsQuoter.quote({
      tokenIn: ctx.collateral,
      tokenOut: route.wxdai,
      amount,
      recipient: ctx.executor,
    });
  } catch (error) {
    if (error instanceof NoSwapRouteError) throw new CreditsUnavailableError(error.message, { cause: error });
    throw new QuoteFailedError({ cause: error });
  }

  // the manager calls only the routers it whitelists, and checks the caller received the output
  const [params] = decodeFunctionData({ abi: ALGEBRA_ROUTER_ABI, data: quote.data }).args;
  if (
    !isAddressEqual(quote.router, route.swaprRouter) ||
    !isAddressEqual(params.recipient, ctx.executor) ||
    !isAddressEqual(params.tokenIn, ctx.collateral) ||
    !isAddressEqual(params.tokenOut, route.wxdai) ||
    params.amountIn !== amount
  ) {
    throw new CreditsUnavailableError("The credits swap was quoted for another route than the manager's.");
  }
  const fair = await deps.reader.vaultValue(amount);
  if (quote.amountOut * 10_000n < fair * (10_000n - BigInt(CREDITS_MAX_LOSS_BPS))) {
    throw new CreditsUnavailableError("The credits swap would lose more than allowed to the pool right now.");
  }

  const floor = (quote.amountOut * (10_000n - BigInt(CREDITS_SLIPPAGE_BPS))) / 10_000n;
  const swap = encodeFunctionData({
    abi: ALGEBRA_ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [{ ...params, amountOutMinimum: floor, limitSqrtPrice: 0n }],
  });

  return {
    // splitFromBase deposits the xDAI into the vault in the same call, so this preview is exact at that block
    minted: await deps.reader.previewDeposit(floor),
    calls: [
      {
        to: route.manager,
        value: 0n,
        data: encodeFunctionData({
          abi: creditsManagerAbi,
          functionName: "execute",
          args: [route.swaprRouter, swap, amount, route.wxdai],
        }),
      },
      {
        to: route.wxdai,
        value: 0n,
        data: encodeFunctionData({ abi: wxdaiAbi, functionName: "withdraw", args: [floor] }),
      },
      {
        to: ctx.router,
        value: floor,
        data: encodeFunctionData({ abi: gnosisRouterAbi, functionName: "splitFromBase", args: [ctx.parentMarket] }),
      },
    ],
  };
}

async function predictCalls(args: {
  ctx: PredictCtx;
  stepId: string;
  options: PredictOption[];
  /** Collateral to split at the parent, which gives every option its underlying. */
  mint: bigint;
  /** The first batch's credits leg, whose minted collateral every option gets as well. */
  credits?: CreditsLeg;
  deps: PredictDeps;
}): Promise<ExecutorValueCall[]> {
  const { ctx, stepId, options, mint, credits, deps } = args;
  const states = await deps.reader.optionStates({ options, executor: ctx.executor });

  const calls: ExecutorValueCall[] = [
    ...(credits?.calls ?? []),
    ...(mint > 0n
      ? splitCalls({ router: ctx.router, collateral: ctx.collateral, market: ctx.parentMarket, amount: mint })
      : []
    ).map(withoutValue),
  ];
  const perOption = mint + (credits?.minted ?? 0n);

  let traded = 0;
  for (const [index, option] of options.entries()) {
    const state = states[index];
    if (state === undefined) continue;

    try {
      calls.push(...(await optionCalls(ctx, option, state, perOption, deps)).map(withoutValue));
      traded += 1;
    } catch (reason) {
      if (reason instanceof QuoteFailedError) throw reason;
      deps.onSkip?.(option, reason, stepId);
    }
  }

  if (traded === 0) {
    throw new NoRouteError("No route was found for any of these estimates. Try again in a moment, or a larger amount.");
  }

  return calls;
}

const withoutValue = (call: ExecutorCall): ExecutorValueCall => ({ ...call, value: 0n });

/** `batchValueExecute` only when a call carries native value, so a run without credits signs `batchExecute`. */
function batchTx(executor: Address, calls: ExecutorValueCall[]): FlowTx {
  return calls.some((call) => call.value > 0n)
    ? batchValueExecuteTx(executor, calls)
    : batchExecuteTx(
        executor,
        calls.map(({ to, data }) => ({ to, data })),
      );
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

  if (snapshot.creditsFromEoa > 0n) {
    steps.push({
      id: STEP_ID.addCredits,
      label: "Add credits to your trade wallet",
      // the trade wallet's credits only grow by this transfer until the first batch burns them
      canSkip: async (ctx, snap) =>
        (await deps.reader.creditsBalance(ctx.executor)) >= snap.creditsAtStart + snap.creditsFromEoa,
      build: (ctx, snap) => {
        if (ctx.credits === null) throw new PredictConfigError("Credits cannot fund this session on this network.");
        return {
          to: ctx.credits.token,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [ctx.executor, snap.creditsFromEoa],
          }),
        };
      },
    });
  }

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
      const id = STEP_ID.predict(index + 1);

      const spends = index === 0 && snapshot.creditsToSpend > 0n;
      return {
        id,
        label:
          batches.length === 1 ? "Making your prediction" : `Making your prediction, ${index + 1} of ${batches.length}`,
        // the batch is atomic, so burned credits show it landed when a closed tab left no hash
        ...(spends
          ? {
              canSkip: async (ctx: PredictCtx, snap: Readonly<PredictSnapshot>) =>
                (await deps.reader.creditsBalance(ctx.executor)) + snap.creditsToSpend <=
                snap.creditsAtStart + snap.creditsFromEoa,
            }
          : {}),
        // Only the first batch splits collateral: it hands every option its underlying at once.
        build: async (ctx, snap) =>
          batchTx(
            ctx.executor,
            await predictCalls({
              ctx,
              stepId: id,
              options: snap.options.filter((option) => optionIds.has(option.childMarket)),
              mint: index === 0 ? snap.collateralIn : 0n,
              credits: spends ? await creditsLeg(ctx, snap.creditsToSpend, deps) : undefined,
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
  const credits = snapshot.creditsToSpend > 0n ? await creditsLeg(ctx, snapshot.creditsToSpend, deps) : undefined;
  const mint = snapshot.collateralIn + (credits?.minted ?? 0n);
  for (const [index, options] of batched(snapshot.options, deps.optionsPerBatch ?? PREDICT_BATCH_SIZE).entries()) {
    await predictCalls({ ctx, stepId: STEP_ID.predict(index + 1), options, mint, deps: quiet });
  }
}

export function createPredictHooks(
  deps: Pick<PredictDeps, "reader"> & {
    /** The options a settled batch left out, handed over once so the snapshot keeps them. */
    takeSkips?: (stepId: string) => Address[];
  },
): FlowHooks<PredictSnapshot, PredictCtx> {
  return {
    async afterStep({ ctx, snapshot, completed }) {
      const left = deps.takeSkips?.(completed.stepId) ?? [];
      if (left.length > 0) {
        const before = snapshot.skipped ?? [];
        return { snapshotPatch: { skipped: [...before, ...left.filter((market) => !before.includes(market))] } };
      }
      if (completed.stepId !== STEP_ID.deposit || !snapshot.depositNative) return;

      // The adapter mints whatever the xDAI was worth, which is only knowable once it lands.
      const minted = (await deps.reader.collateralBalance(ctx.executor)) - snapshot.collateralAtStart;
      return { snapshotPatch: { collateralIn: minted + tradeWalletShare(snapshot) } };
    },
  };
}

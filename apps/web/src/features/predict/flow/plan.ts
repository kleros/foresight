import type { FlowHooks, FlowTx, TxStep } from "@foresight/tx-orchestrator";
import {
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  isAddressEqual,
  parseEventLogs,
  type Address,
  type Log,
} from "viem";

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

import { creditsManagerAbi, gnosisRouterAbi, tradeExecutorAbi, wxdaiAbi } from "@/config/contracts";

import { STEP_ID } from "./stepIds";
import type {
  CreditsSwapPreview,
  HeldTo,
  LandedTx,
  MovedPlans,
  OptionChainState,
  PredictCtx,
  PlannedRequest,
  PredictOption,
  PredictReader,
  PredictSlippage,
  PredictSnapshot,
} from "./types";
import { DEFAULT_SLIPPAGE, MAX_SLIPPAGE_BPS } from "../oracle/tolerances";
import {
  atEstimate,
  planBuys,
  planChanged,
  planSells,
  previewTrades,
  type OptionSide,
  type PreviewTrades,
  type SoldLeg,
} from "../utils/plan";

/**
 * The predict-flow adapter: set up the trade wallet, add money, then move the pools toward the
 * visitor's estimates. The trades are quoted inside `build`, which the orchestrator runs afresh
 * on every attempt, so a retry or a resume prices against the pools as they are then.
 */

type Step = TxStep<PredictSnapshot, PredictCtx>;

export { STEP_ID };

/** Gas a predict batch spends besides its options, the parent split included; ~0.57M on a Gnosis fork. */
export const BATCH_BASE_GAS = 700_000n;
/** Gas each option adds to a batch: its split, legs and merge; ~1.25M on a Gnosis fork. */
export const OPTION_GAS = 1_500_000n;
/** Gas the credits leg adds to the first batch; ~0.53M on a Gnosis fork. */
export const CREDITS_LEG_GAS = 700_000n;
/** Of ten thousand, the share of the block gas limit one batch is sized to fill. */
export const BATCH_GAS_SHARE_BPS = 5_000n;
/** The most gas one transaction may use where EIP-7825 applies, whatever the block's limit. */
export const MAX_TX_GAS = 16_777_216n;

/** What a batch of `options` is sized to spend, the credits leg included when it carries one. */
export const batchGas = (options: number, credits: boolean): bigint =>
  BATCH_BASE_GAS + (credits ? CREDITS_LEG_GAS : 0n) + BigInt(options) * OPTION_GAS;

/** The options one batch holds under `blockGasLimit`'s budget; never fewer than one. */
export function optionsPerBatch(blockGasLimit: bigint, credits: boolean): number {
  const share = (blockGasLimit * BATCH_GAS_SHARE_BPS) / 10_000n;
  const room = (share < MAX_TX_GAS ? share : MAX_TX_GAS) - batchGas(0, credits);
  return room < OPTION_GAS ? 1 : Number(room / OPTION_GAS);
}

export interface PredictDeps {
  reader: PredictReader;
  quoter: SwapQuoter;
  /** Quotes the swap the credits manager makes; needed only by a run that spends credits. */
  creditsQuoter?: ExactInputQuoter;
  /** Told about an option no route could be found for, which the batch `stepId` leaves out. */
  onLeftOut?: (option: PredictOption, reason: unknown, stepId: string) => void;
  /** What the visitor was shown; a batch whose plan differs is not signed. None holds nothing. */
  heldTo?: () => HeldTo | undefined;
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

/** Every option's pools already sit at its estimate, so there is nothing to trade. */
export class AtEstimatesError extends Error {
  constructor() {
    super("Every pool already sits at its estimate.");
    this.name = "AtEstimatesError";
  }
}

/** One option's pools already sit at its estimate. */
class OptionAtEstimate extends Error {}

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

/** The credits cannot be spent now: the manager is short, no route swaps them, or the route pays elsewhere. */
export class CreditsUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CreditsUnavailableError";
  }
}

/** The pools give another plan, or the credits swap pays less, than the run is held to. */
export class PlansMovedError extends Error {
  constructor(readonly moved: MovedPlans) {
    super("The pools moved since the plan was shown.");
    this.name = "PlansMovedError";
  }
}

/** Of ten thousand, how far a plan's figures may move from those shown before it is moved, at most. */
export const MOVED_TOLERANCE_BPS = DEFAULT_SLIPPAGE.tradeBps;

/** The owner has a transaction broadcast and not mined, which may be the one a step would sign again. */
export class TxPendingError extends Error {
  constructor() {
    super("A transaction from this wallet has not been mined yet.");
    this.name = "TxPendingError";
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
  slippageBps: number,
  deps: PredictDeps,
): Promise<ExecutorCall[]> {
  const splitAmount = state.underlying + mint;
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
    if (atEstimate(target)) throw new OptionAtEstimate(`${option.childMarket} already sits at your estimate.`);
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
  /** What each option splits of the mint: the vault's preview less `MINT_RATE_MARGIN_BPS`. */
  minted: bigint;
  /** The swap as quoted now, when it pays less than the floor the run is held to, or none was shown. */
  moved?: CreditsSwapPreview;
}

/**
 * Of ten thousand, held back from the credits' mint when each option's split is sized. Interest
 * landing in sDAI raises its rate, so `splitFromBase` can mint less than the build-time preview.
 */
export const MINT_RATE_MARGIN_BPS = 1n;

async function quoteCreditsSwap(
  ctx: Pick<PredictCtx, "collateral" | "executor" | "credits">,
  amount: bigint,
  creditsBps: number,
  deps: Pick<PredictDeps, "reader" | "creditsQuoter">,
) {
  const route = ctx.credits;
  if (route === null) throw new PredictConfigError("Credits cannot fund this session on this network.");
  if (!deps.creditsQuoter) throw new PredictConfigError("There is no quoter for the credits swap.");

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

  const vaultValue = await deps.reader.vaultValue(amount);
  const floor = (quote.amountOut * (10_000n - BigInt(creditsBps))) / 10_000n;
  const preview: CreditsSwapPreview = {
    quoted: quote.amountOut,
    vaultValue,
    floor,
    loss: vaultValue > quote.amountOut ? vaultValue - quote.amountOut : 0n,
    minted: await mintedFrom(floor, deps),
  };
  return { params, preview };
}

/** The collateral each option splits of `floor` xDAI, held back so a rate rise cannot leave the split short. */
async function mintedFrom(floor: bigint, deps: Pick<PredictDeps, "reader">): Promise<bigint> {
  const preview = await deps.reader.previewDeposit(floor);
  return preview - (preview * MINT_RATE_MARGIN_BPS) / 10_000n;
}

/** The credits swap a run spending `amount` would make now, for the popup to show before Predict. */
export async function previewCreditsSwap(
  ctx: Pick<PredictCtx, "collateral" | "executor" | "credits">,
  amount: bigint,
  creditsBps: number,
  deps: Pick<PredictDeps, "reader" | "creditsQuoter">,
): Promise<CreditsSwapPreview> {
  return (await quoteCreditsSwap(ctx, amount, creditsBps, deps)).preview;
}

/**
 * The manager swaps `creditsToSpend` of its collateral for WXDAI paid to the executor, which unwraps
 * the floor and splits it at the parent as xDAI. The surplus over the floor stays as WXDAI.
 * A run held to a shown swap keeps its floor, so the split is the one shown.
 */
async function creditsLeg(ctx: PredictCtx, amount: bigint, creditsBps: number, deps: PredictDeps): Promise<CreditsLeg> {
  const route = ctx.credits;
  if (route === null) throw new PredictConfigError("Credits cannot fund this session on this network.");
  if ((await deps.reader.managerCollateral()) < amount) {
    throw new CreditsUnavailableError("The credits manager cannot cover these credits right now.");
  }

  const { params, preview: swapped } = await quoteCreditsSwap(ctx, amount, creditsBps, deps);
  const held = deps.heldTo?.();
  const moved = held !== undefined && (held.credits === undefined || swapped.quoted < held.credits.floor);
  const floor = !moved && held?.credits ? held.credits.floor : swapped.floor;
  const swap = encodeFunctionData({
    abi: ALGEBRA_ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [{ ...params, amountOutMinimum: floor, limitSqrtPrice: 0n }],
  });

  return {
    minted: await mintedFrom(floor, deps),
    ...(moved ? { moved: swapped } : {}),
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
  slippageBps: number;
  deps: PredictDeps;
}): Promise<ExecutorValueCall[]> {
  const { ctx, stepId, options, mint, credits, slippageBps, deps } = args;
  const states = await deps.reader.optionStates({ options, executor: ctx.executor });
  const held = deps.heldTo?.();
  if (held) {
    const moved = movedFrom(held, options, states, mint + (credits?.minted ?? 0n), slippageBps);
    if (moved.markets.length > 0 || credits?.moved) {
      throw new PlansMovedError({ ...moved, ...(credits?.moved ? { credits: credits.moved } : {}) });
    }
  }

  const calls: ExecutorValueCall[] = [
    ...(credits?.calls ?? []),
    ...(mint > 0n
      ? splitCalls({ router: ctx.router, collateral: ctx.collateral, market: ctx.parentMarket, amount: mint })
      : []
    ).map(withoutValue),
  ];
  const perOption = mint + (credits?.minted ?? 0n);

  let traded = 0;
  const reasons: unknown[] = [];
  for (const [index, option] of options.entries()) {
    const state = states[index];
    if (state === undefined) continue;

    try {
      calls.push(...(await optionCalls(ctx, option, state, perOption, slippageBps, deps)).map(withoutValue));
      traded += 1;
    } catch (reason) {
      if (reason instanceof QuoteFailedError) throw reason;
      reasons.push(reason);
      deps.onLeftOut?.(option, reason, stepId);
    }
  }

  if (traded === 0) {
    if (reasons.length > 0 && reasons.every((reason) => reason instanceof OptionAtEstimate)) {
      throw new AtEstimatesError();
    }
    throw new NoRouteError("No route was found for any of these estimates. Try again in a moment, or a larger amount.");
  }

  return calls;
}

const withoutValue = (call: ExecutorCall): ExecutorValueCall => ({ ...call, value: 0n });

const trades = (plan: PreviewTrades) => plan.sells.length > 0 || plan.buys.length > 0;

/**
 * Each option's plan as the pools give it now, worked out as the popup's preview does, and the
 * options whose plan differs from `held`'s; an option shown no plan differs once it trades.
 */
function movedFrom(
  held: HeldTo,
  options: PredictOption[],
  states: OptionChainState[],
  perOption: bigint,
  slippageBps: number,
): MovedPlans {
  const tolerance = Math.min(slippageBps, MOVED_TOLERANCE_BPS);
  const plans: Record<string, PreviewTrades> = {};
  const markets: Address[] = [];
  for (const [index, option] of options.entries()) {
    const state = states[index];
    if (state === undefined) continue;
    const now = previewTrades(
      {
        pools: state.pools,
        targetPriceWad: option.targetPriceWad,
        held: state.held,
        splitAmount: state.underlying + perOption,
      },
      slippageBps,
    );
    if (now === null) continue;
    const key = option.childMarket.toLowerCase();
    plans[key] = now;
    const before = held.plans[key];
    if (before === undefined ? trades(now) : planChanged(before, now, tolerance)) markets.push(option.childMarket);
  }
  return { markets, plans };
}

/** One moved result for several batches. */
const mergeMoved = (into: MovedPlans | undefined, next: MovedPlans): MovedPlans => ({
  markets: [...(into?.markets ?? []), ...next.markets],
  plans: { ...into?.plans, ...next.plans },
  ...((next.credits ?? into?.credits) ? { credits: next.credits ?? into?.credits } : {}),
});

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

function addCreditsTx(ctx: PredictCtx, snap: Readonly<PredictSnapshot>): FlowTx {
  if (ctx.credits === null) throw new PredictConfigError("Credits cannot fund this session on this network.");
  return {
    to: ctx.credits.token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [ctx.executor, snap.creditsFromEoa] }),
  };
}

function depositStepTx(ctx: PredictCtx, snap: Readonly<PredictSnapshot>): FlowTx {
  if (!snap.depositNative) {
    return depositTx({ executor: ctx.executor, asset: { token: ctx.collateral, amount: snap.deposit } });
  }
  if (ctx.sDaiAdapter === null) {
    throw new PredictConfigError("This network has no xDAI route into the trade wallet.");
  }
  return depositNativeTx({ executor: ctx.executor, sDaiAdapter: ctx.sDaiAdapter, amount: snap.deposit });
}

const landedSince = (deps: Pick<PredictDeps, "reader">, ctx: PredictCtx, snap: Readonly<PredictSnapshot>) =>
  deps.reader.landedSince({ owner: ctx.owner, executor: ctx.executor, fromBlock: snap.fromBlock });

/** `landed` is `tx` itself: the same target, value and calldata. */
export const isTx = (landed: Pick<LandedTx, "to" | "value" | "input">, tx: FlowTx): boolean =>
  isAddressEqual(landed.to, tx.to) &&
  landed.value === (tx.value ?? 0n) &&
  landed.input.toLowerCase() === (tx.data ?? "0x").toLowerCase();

/**
 * `landed` is this run's first batch: a batch on its trade wallet that splits its sDAI and spends
 * its credits at its parent market. Its trades are rebuilt from fresh quotes, so they are not compared.
 */
function isFirstBatch(landed: LandedTx, ctx: PredictCtx, snap: Readonly<PredictSnapshot>): boolean {
  if (!isAddressEqual(landed.to, ctx.executor)) return false;
  let calls: readonly { to: Address; data: `0x${string}` }[];
  try {
    const batch = decodeFunctionData({ abi: tradeExecutorAbi, data: landed.input });
    if (batch.functionName !== "batchExecute" && batch.functionName !== "batchValueExecute") return false;
    calls = batch.args[0];
  } catch {
    return false;
  }

  const decoded = (abi: typeof gnosisRouterAbi | typeof creditsManagerAbi, data: `0x${string}`) => {
    try {
      return decodeFunctionData({ abi, data });
    } catch {
      return undefined;
    }
  };
  const routerCalls = calls.filter((call) => isAddressEqual(call.to, ctx.router));
  const splits =
    snap.collateralIn === 0n ||
    routerCalls.some((call) => {
      const inner = decoded(gnosisRouterAbi, call.data);
      return (
        inner?.functionName === "splitPosition" &&
        isAddressEqual(inner.args[0], ctx.collateral) &&
        isAddressEqual(inner.args[1], ctx.parentMarket) &&
        inner.args[2] === snap.collateralIn
      );
    });
  const manager = ctx.credits?.manager;
  const spends =
    snap.creditsToSpend === 0n ||
    (manager !== undefined &&
      calls.some((call) => {
        const inner = isAddressEqual(call.to, manager) ? decoded(creditsManagerAbi, call.data) : undefined;
        return inner?.functionName === "execute" && inner.args[2] === snap.creditsToSpend;
      }) &&
      routerCalls.some((call) => {
        const inner = decoded(gnosisRouterAbi, call.data);
        return inner?.functionName === "splitFromBase" && isAddressEqual(inner.args[0], ctx.parentMarket);
      }));
  return splits && spends;
}

/**
 * Whether a money step already landed, found by its own transaction since the run's pinned block.
 * A transaction still in the mempool shows in no log, so while one is out nothing is signed again.
 */
async function landedOrPending(
  deps: Pick<PredictDeps, "reader">,
  ctx: PredictCtx,
  snap: Readonly<PredictSnapshot>,
  matches: (landed: LandedTx) => boolean,
): Promise<boolean> {
  if ((await landedSince(deps, ctx, snap)).some(matches)) return true;
  if (await deps.reader.hasPending(ctx.owner)) throw new TxPendingError();
  return false;
}

/** The collateral a receipt's logs show moving into the trade wallet. */
function collateralInto(logs: Log[], ctx: PredictCtx): bigint {
  return parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs })
    .filter((log) => isAddressEqual(log.address, ctx.collateral) && isAddressEqual(log.args.to, ctx.executor))
    .reduce((sum, log) => sum + log.args.value, 0n);
}

const validSlippage = (bps: number) => Number.isInteger(bps) && bps >= 0 && bps <= MAX_SLIPPAGE_BPS;

function assertSlippage(slippage: PredictSlippage): void {
  if (!validSlippage(slippage.tradeBps) || !validSlippage(slippage.creditsBps)) {
    throw new PredictConfigError(`Slippage must be a whole number of basis points from 0 to ${MAX_SLIPPAGE_BPS}.`);
  }
}

export function planPredict(snapshot: PlannedRequest, deps: PredictDeps): Step[] {
  if (snapshot.options.length === 0) {
    throw new PredictConfigError("There are no estimates to predict.");
  }
  assertSlippage(snapshot.slippage);
  if (!Number.isInteger(snapshot.optionsPerBatch) || snapshot.optionsPerBatch < 1) {
    throw new PredictConfigError("A batch must hold at least one option.");
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
      canSkip: (ctx, snap) => landedOrPending(deps, ctx, snap, (landed) => isTx(landed, addCreditsTx(ctx, snap))),
      build: addCreditsTx,
    });
  }

  if (snapshot.deposit > 0n) {
    steps.push({
      id: STEP_ID.deposit,
      label: "Add money to your trade wallet",
      canSkip: (ctx, snap) => landedOrPending(deps, ctx, snap, (landed) => isTx(landed, depositStepTx(ctx, snap))),
      build: depositStepTx,
    });
  }

  const batches = batched(snapshot.options, snapshot.optionsPerBatch);

  steps.push(
    ...batches.map((options, index): Step => {
      const optionIds = new Set(options.map((option) => option.childMarket));
      const id = STEP_ID.predict(index + 1);

      const spends = index === 0 && snapshot.creditsToSpend > 0n;
      return {
        id,
        label:
          batches.length === 1 ? "Making your prediction" : `Making your prediction, ${index + 1} of ${batches.length}`,
        ...(index === 0
          ? {
              canSkip: (ctx: PredictCtx, snap: Readonly<PredictSnapshot>) =>
                landedOrPending(deps, ctx, snap, (landed) => isFirstBatch(landed, ctx, snap)),
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
              credits: spends ? await creditsLeg(ctx, snap.creditsToSpend, snap.slippage.creditsBps, deps) : undefined,
              slippageBps: snap.slippage.tradeBps,
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
  const quiet = { ...deps, onLeftOut: undefined };
  const { tradeBps, creditsBps } = snapshot.slippage;
  const credits =
    snapshot.creditsToSpend > 0n ? await creditsLeg(ctx, snapshot.creditsToSpend, creditsBps, deps) : undefined;
  const batches = batched(snapshot.options, snapshot.optionsPerBatch);
  let atEstimates = 0;
  let moved: MovedPlans | undefined;
  for (const [index, options] of batches.entries()) {
    try {
      await predictCalls({
        ctx,
        stepId: STEP_ID.predict(index + 1),
        options,
        mint: snapshot.collateralIn + (index > 0 ? (credits?.minted ?? 0n) : 0n),
        credits: index === 0 ? credits : undefined,
        slippageBps: tradeBps,
        deps: quiet,
      });
    } catch (error) {
      if (error instanceof PlansMovedError) moved = mergeMoved(moved, error.moved);
      else if (error instanceof AtEstimatesError) atEstimates += 1;
      else throw error;
    }
  }
  if (moved) throw new PlansMovedError(moved);
  if (atEstimates === batches.length) throw new AtEstimatesError();
  if (atEstimates > 0) {
    throw new NoRouteError(
      "No route was found for some of these estimates. Try again in a moment, or a larger amount.",
    );
  }
}

export function createPredictHooks(
  deps: Pick<PredictDeps, "reader"> & {
    /** The options a settled batch left out, handed over once so the snapshot keeps them. */
    takeLeftOut?: (stepId: string) => Address[];
  },
): FlowHooks<PredictSnapshot, PredictCtx> {
  return {
    async afterStep({ ctx, snapshot, completed, receipt }) {
      const left = deps.takeLeftOut?.(completed.stepId) ?? [];
      if (left.length > 0) {
        const before = snapshot.leftOut ?? [];
        return { snapshotPatch: { leftOut: [...before, ...left.filter((market) => !before.includes(market))] } };
      }
      if (completed.stepId !== STEP_ID.deposit || !snapshot.depositNative) return;

      // The adapter mints whatever the xDAI was worth, which only the deposit's own logs show.
      const minted = receipt
        ? collateralInto(receipt.logs, ctx)
        : (await landedSince(deps, ctx, snapshot)).find((landed) => isTx(landed, depositStepTx(ctx, snapshot)))
            ?.collateralReceived;
      if (minted === undefined) throw new Error("The deposit's transaction was not found on chain.");
      return { snapshotPatch: { collateralIn: minted + tradeWalletShare(snapshot) } };
    },
  };
}

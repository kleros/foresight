import type { FlowTx } from "@foresight/tx-orchestrator";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  erc20Abi,
  zeroAddress,
  type Address,
  type Hex,
  type Log,
} from "viem";

import { ALGEBRA_ROUTER_ABI } from "@/lib/swap/algebraRouter";
import {
  NoSwapRouteError,
  type ExactInputQuoter,
  type ExactInputRequest,
  type SwapQuote,
  type SwapQuoteRequest,
  type SwapQuoter,
} from "@/lib/swap/types";

import { CREDITS_SLIPPAGE_BPS, SLIPPAGE_BPS } from "../../../oracle/tolerances";
import { swapToward } from "../../../utils/poolMath";
import { batchGas, BATCH_GAS_SHARE_BPS } from "../../plan";
import type {
  GasEstimateTx,
  LandedTx,
  OptionChainState,
  PredictCtx,
  PredictOption,
  PredictReader,
  PredictSnapshot,
} from "../../types";

/** Sqrt prices exact at X96, so a volume to target is a round number. */
export const AT = { "0.25": 2n ** 95n, "1": 2n ** 96n } as const;

export const WAD = 10n ** 18n;
/** Deep enough that a leg is sized by the budget rather than by the pool. */
export const DEEP = 10n ** 30n;

export const addresses = {
  owner: "0x0000000000000000000000000000000000000001" as Address,
  executor: "0x0000000000000000000000000000000000000002" as Address,
  factory: "0x0000000000000000000000000000000000000003" as Address,
  router: "0x0000000000000000000000000000000000000004" as Address,
  collateral: "0x0000000000000000000000000000000000000005" as Address,
  parentMarket: "0x0000000000000000000000000000000000000006" as Address,
  sDaiAdapter: "0x0000000000000000000000000000000000000007" as Address,
  swapRouter: "0x0000000000000000000000000000000000000008" as Address,
  credits: "0x0000000000000000000000000000000000000009" as Address,
  manager: "0x000000000000000000000000000000000000000A" as Address,
  wxdai: "0x000000000000000000000000000000000000000b" as Address,
} as const;

export const ctx = (overrides: Partial<PredictCtx> = {}): PredictCtx => ({
  chainId: 100,
  owner: addresses.owner,
  executor: addresses.executor,
  factory: addresses.factory,
  router: addresses.router,
  collateral: addresses.collateral,
  parentMarket: addresses.parentMarket,
  sDaiAdapter: addresses.sDaiAdapter,
  credits: {
    token: addresses.credits,
    manager: addresses.manager,
    wxdai: addresses.wxdai,
    swaprRouter: addresses.swapRouter,
  },
  ...overrides,
});

/** Option `index`, with tokens whose addresses say which option and which side they are. */
export function option(index: number, targetPriceWad = WAD / 4n): PredictOption {
  const at = (slot: number) => `0x${String(index).padStart(2, "0")}${String(slot).repeat(38)}` as Address;
  return {
    childMarket: at(1),
    underlying: at(2),
    upToken: at(3),
    downToken: at(4),
    invalidToken: at(5),
    targetPriceWad,
  };
}

/** UP above its target so it sells, DOWN below its target so it buys. */
export const chainState = (overrides: Partial<OptionChainState> = {}): OptionChainState => ({
  pools: {
    // shallow, so the sell stops at the target with pairs still in hand for the merge
    up: { sqrtPriceX96: AT["1"], liquidity: WAD / 2n, tick: 0, fee: 0n, ticks: [], outcomeIsToken0: true },
    down: { sqrtPriceX96: AT["0.25"], liquidity: DEEP, tick: 0, fee: 0n, ticks: [], outcomeIsToken0: true },
  },
  held: { up: 0n, down: 0n, invalid: 0n },
  underlying: 0n,
  ...overrides,
});

export const snapshot = (overrides: Partial<PredictSnapshot> = {}): PredictSnapshot => ({
  options: [option(1)],
  deposit: WAD,
  depositNative: false,
  collateralIn: WAD,
  collateralBefore: 0n,
  collateralAtStart: 0n,
  creditsFromEoa: 0n,
  creditsToSpend: 0n,
  creditsAtStart: 0n,
  fromBlock: 1n,
  startedAt: 1_700_000_000,
  slippage: { tradeBps: SLIPPAGE_BPS, creditsBps: CREDITS_SLIPPAGE_BPS },
  optionsPerBatch: 10,
  ...overrides,
});

export interface FakeReader extends PredictReader {
  /** Every `optionStates` call, so a test can see what a build asked for. */
  readonly asked: Array<{ options: PredictOption[]; executor: Address }>;
  /** Every transaction the node was asked to estimate. */
  readonly estimated: GasEstimateTx[];
}

/** A block gas limit whose batch budget holds exactly `options` options, with or without the credits leg. */
export const gasLimitFor = (options: number): bigint => (batchGas(options, true) * 10_000n) / BATCH_GAS_SHARE_BPS;

/** 1.25 xDAI per sDAI share, the fakes' vault rate. */
export const VAULT_RATE = (WAD * 5n) / 4n;

export function fakeReader(
  opts: {
    deployed?: boolean;
    collateral?: bigint;
    state?: (option: PredictOption) => OptionChainState;
    /** Credits per holder; a function reads a balance that changes as a test's chain moves. */
    credits?: Partial<Record<Address, bigint>> | ((holder: Address) => bigint);
    /** The credits manager's collateral, 1000 by default. */
    manager?: bigint | (() => bigint);
    /** The owner's transactions the chain shows landed; a function reads a ledger that grows. */
    landed?: LandedTx[] | (() => LandedTx[]);
    /** True while the owner has a transaction broadcast and not mined. */
    pending?: () => boolean;
    /** The latest block's gas limit, Gnosis' 17M by default. */
    blockGasLimit?: bigint;
    /** What the node estimates a transaction at; by default it cannot estimate one. */
    estimateGas?: (tx: GasEstimateTx) => Promise<bigint>;
  } = {},
): FakeReader {
  const asked: FakeReader["asked"] = [];
  const estimated: FakeReader["estimated"] = [];
  const credits = opts.credits;
  const manager = opts.manager;

  return {
    asked,
    estimated,
    estimateGas: (tx) => {
      estimated.push(tx);
      return opts.estimateGas ? opts.estimateGas(tx) : Promise.reject(new Error("execution reverted"));
    },
    isExecutorDeployed: () => Promise.resolve(opts.deployed ?? false),
    collateralBalance: () => Promise.resolve(opts.collateral ?? 0n),
    creditsBalance: (holder) =>
      Promise.resolve(typeof credits === "function" ? credits(holder) : (credits?.[holder] ?? 0n)),
    managerCollateral: () => Promise.resolve(typeof manager === "function" ? manager() : (manager ?? 1000n * WAD)),
    previewDeposit: (assets) => Promise.resolve((assets * WAD) / VAULT_RATE),
    vaultValue: (shares) => Promise.resolve((shares * VAULT_RATE) / WAD),
    latestBlock: () => Promise.resolve(1n),
    latestTimestamp: () => Promise.resolve(0n),
    blockGasLimit: () => Promise.resolve(opts.blockGasLimit ?? 17_000_000n),
    landedSince: () => Promise.resolve(typeof opts.landed === "function" ? opts.landed() : (opts.landed ?? [])),
    hasPending: () => Promise.resolve(opts.pending?.() ?? false),
    nextNonce: () => Promise.resolve(0),
    sentWithNonce: () => Promise.resolve({ status: "none" }),
    optionStates: (args) => {
      asked.push(args);
      return Promise.resolve(args.options.map((each) => opts.state?.(each) ?? chainState()));
    },
  };
}

export interface FakeQuoter extends SwapQuoter {
  readonly requests: SwapQuoteRequest[];
}

/**
 * Pays out half of what goes in, and encodes the pair it was asked for in its calldata so a test
 * can tell one leg's swap from another's.
 */
export function fakeQuoter(
  opts: {
    refuse?: (request: SwapQuoteRequest) => boolean;
    /** Encodes Swapr's `exactInputSingle` with the request's recipient and limit, as the Lens quoter signs it. */
    asSwapr?: boolean;
  } = {},
): FakeQuoter {
  const requests: SwapQuoteRequest[] = [];

  return {
    requests,
    quote: (request) => {
      requests.push(request);
      if (opts.refuse?.(request)) return Promise.reject(new NoSwapRouteError("No route."));

      const quote: SwapQuote = {
        amountIn: request.amount,
        amountOut: request.amount / 2n,
        router: addresses.swapRouter,
        data: opts.asSwapr
          ? encodeFunctionData({
              abi: ALGEBRA_ROUTER_ABI,
              functionName: "exactInputSingle",
              args: [
                {
                  tokenIn: request.tokenIn,
                  tokenOut: request.tokenOut,
                  recipient: request.recipient,
                  deadline: 1_700_001_800n,
                  amountIn: request.amount,
                  amountOutMinimum: request.amount / 2n,
                  limitSqrtPrice: request.limitSqrtPrice,
                },
              ],
            })
          : (`0x${request.tokenIn.slice(2)}${request.tokenOut.slice(2)}` as Hex),
        value: 0n,
      };
      return Promise.resolve(quote);
    },
  };
}

/**
 * Prices each leg of `options` by the pool maths the popup's preview uses, against the pools `state`
 * gives when the quote is asked, so a quote agrees with a plan shown from the same pools.
 */
export function poolQuoter(
  options: readonly PredictOption[] | (() => readonly PredictOption[]),
  state: (option: PredictOption) => OptionChainState = () => chainState(),
): FakeQuoter {
  const requests: SwapQuoteRequest[] = [];
  return {
    requests,
    quote: (request) => {
      requests.push(request);
      const tokens = [request.tokenIn, request.tokenOut];
      const option = (typeof options === "function" ? options() : options).find(
        (each) => tokens.includes(each.upToken) || tokens.includes(each.downToken),
      );
      if (!option) return Promise.reject(new NoSwapRouteError("No pool."));
      const side = tokens.includes(option.upToken) ? "up" : "down";
      const target = side === "up" ? option.targetPriceWad : WAD - option.targetPriceWad;
      const { amountOut } = swapToward(state(option).pools[side], target, request.amount);
      return Promise.resolve({
        amountIn: request.amount,
        amountOut,
        router: addresses.swapRouter,
        data: encodeFunctionData({
          abi: ALGEBRA_ROUTER_ABI,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn: request.tokenIn,
              tokenOut: request.tokenOut,
              recipient: request.recipient,
              deadline: 1_700_001_800n,
              amountIn: request.amount,
              amountOutMinimum: amountOut,
              limitSqrtPrice: request.limitSqrtPrice,
            },
          ],
        }),
        value: 0n,
      });
    },
  };
}

/** Sends each quote for `target`'s tokens to `quoter`, and every other quote to `rest`. */
export function quoterFor(target: PredictOption, quoter: SwapQuoter, rest: SwapQuoter): SwapQuoter {
  const tokens = [target.underlying, target.upToken, target.downToken];
  return {
    quote: (request) =>
      tokens.includes(request.tokenIn) || tokens.includes(request.tokenOut)
        ? quoter.quote(request)
        : rest.quote(request),
  };
}

export { ALGEBRA_ROUTER_ABI };

export interface FakeExactInputQuoter extends ExactInputQuoter {
  readonly requests: ExactInputRequest[];
}

/**
 * Swaps at the vault rate less `lossBps`, through `router`, encoding the request as Swapr's
 * `exactInputSingle` with no minimum and no limit, as Lens does.
 */
export function fakeCreditsQuoter(
  opts: {
    /** A function reads a loss that changes as a test's pool moves. */
    lossBps?: bigint | (() => bigint);
    router?: Address;
    recipient?: Address;
    refuse?: boolean;
  } = {},
): FakeExactInputQuoter {
  const requests: ExactInputRequest[] = [];
  return {
    requests,
    quote: (request) => {
      requests.push(request);
      if (opts.refuse) return Promise.reject(new NoSwapRouteError("No route."));
      const lossBps = typeof opts.lossBps === "function" ? opts.lossBps() : (opts.lossBps ?? 5n);
      const amountOut = (((request.amount * VAULT_RATE) / WAD) * (10_000n - lossBps)) / 10_000n;
      return Promise.resolve({
        amountOut,
        router: opts.router ?? addresses.swapRouter,
        data: encodeFunctionData({
          abi: ALGEBRA_ROUTER_ABI,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn: request.tokenIn,
              tokenOut: request.tokenOut,
              recipient: opts.recipient ?? request.recipient,
              deadline: 1_700_001_800n,
              amountIn: request.amount,
              amountOutMinimum: 0n,
              limitSqrtPrice: 0n,
            },
          ],
        }),
      });
    },
  };
}

/** `tx` as the chain shows it once landed, with the collateral it moved into the trade wallet. */
export const landedTx = (tx: FlowTx, collateralReceived = 0n): LandedTx => ({
  to: tx.to,
  value: tx.value ?? 0n,
  input: tx.data ?? "0x",
  collateralReceived,
});

/** The collateral `Transfer` an xDAI deposit's receipt carries, minting `amount` to the trade wallet. */
export const mintLog = (amount: bigint): Log =>
  ({
    address: addresses.collateral,
    topics: encodeEventTopics({
      abi: erc20Abi,
      eventName: "Transfer",
      args: { from: zeroAddress, to: addresses.executor },
    }),
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
  }) as unknown as Log;

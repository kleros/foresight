import type { Address, Hex } from "viem";

import type { SwapQuote, SwapQuoteRequest, SwapQuoter } from "@/lib/swap/types";

import type { OptionChainState, PredictCtx, PredictOption, PredictReader, PredictSnapshot } from "../../types";

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
  startedAt: 1_700_000_000,
  ...overrides,
});

export interface FakeReader extends PredictReader {
  /** Every `optionStates` call, so a test can see what a build asked for. */
  readonly asked: Array<{ options: PredictOption[]; executor: Address }>;
}

export function fakeReader(
  opts: { deployed?: boolean; collateral?: bigint; state?: (option: PredictOption) => OptionChainState } = {},
): FakeReader {
  const asked: FakeReader["asked"] = [];

  return {
    asked,
    isExecutorDeployed: () => Promise.resolve(opts.deployed ?? false),
    collateralBalance: () => Promise.resolve(opts.collateral ?? 0n),
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
export function fakeQuoter(opts: { refuse?: (request: SwapQuoteRequest) => boolean } = {}): FakeQuoter {
  const requests: SwapQuoteRequest[] = [];

  return {
    requests,
    quote: (request) => {
      requests.push(request);
      if (opts.refuse?.(request)) return Promise.reject(new Error("No route."));

      const quote: SwapQuote = {
        amountIn: request.amount,
        amountOut: request.amount / 2n,
        router: addresses.swapRouter,
        data: `0x${request.tokenIn.slice(2)}${request.tokenOut.slice(2)}` as Hex,
        value: 0n,
      };
      return Promise.resolve(quote);
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

import { decodeFunctionData, encodeFunctionData, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createLensQuoter } from "@/lib/swap/lens";
import type { SwapQuoter, SwapQuoteRequest } from "@/lib/swap/types";

import { tradeExecutorAbi } from "@/config/contracts";

import type { PoolLiquidity } from "@/types/pool";

import { SLIPPAGE_BPS } from "../../oracle/tolerances";
import { planPredict, STEP_ID } from "../plan";
import type { PredictOption } from "../types";
import { chainState, ctx, fakeReader, snapshot, WAD } from "./support/fakes";

const ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) payable returns (uint256 amountOut)",
]);
const SWAPR_ROUTER = "0xfFB643E73f280B97809A8b41f7232AB401a04ee1" as Address;

const lensQuote = vi.fn();

vi.mock("@seer-pm/lens/client", () => ({
  Lens: class {
    quote = lensQuote;
  },
}));

/** Algebra orders a pool's tokens by address: UP and DOWN sit below the underlying, so each is token0. */
const OPTION: Omit<PredictOption, "targetPriceWad"> = {
  childMarket: "0x0100000000000000000000000000000000000001",
  upToken: "0x0300000000000000000000000000000000000003",
  downToken: "0x0400000000000000000000000000000000000004",
  invalidToken: "0x0500000000000000000000000000000000000005",
  underlying: "0x0900000000000000000000000000000000000009",
};

/** UP's X96 sqrt price, exact: 2^95 at a price of 0.25, 129 * 2^88 at (129/256)^2. */
const SQRT = { "0.25": 2n ** 95n, "16641/65536": 129n * 2n ** 88n } as const;
const PRICE = { "0.25": WAD / 4n, "16641/65536": (WAD * 16_641n) / 65_536n } as const;

/** Deep enough that a leg clears the dust floor, shallow enough that the split covers the sell. */
const LIQUIDITY = 10n * WAD;

/** Fee in millionths, as Algebra reads it. */
const FEE = { "1%": 10_000n, "1.7%": 17_000n, "3%": 30_000n } as const;

const upPool = (sqrtPriceX96: bigint, fee: bigint): PoolLiquidity => ({
  sqrtPriceX96,
  liquidity: LIQUIDITY,
  tick: 0,
  fee,
  ticks: [],
  outcomeIsToken0: true,
});
const UNPRICED: PoolLiquidity = { sqrtPriceX96: 0n, liquidity: 0n, tick: 0, fee: 0n, ticks: [], outcomeIsToken0: true };

/** Lens's answer for the whole amount with no limit, priced at the pool's starting price. */
function lensQuotesAt(priceWad: bigint) {
  lensQuote.mockImplementation(
    (args: {
      tokenIn: Address;
      tokenOut: Address;
      amount: bigint;
      recipient: Address;
      slippageBps: number;
      deadline: bigint;
    }) => {
      const amountOut =
        args.tokenIn === OPTION.underlying ? (args.amount * WAD) / priceWad : (args.amount * priceWad) / WAD;
      return Promise.resolve({
        amountIn: args.amount,
        amountOut,
        target: SWAPR_ROUTER,
        msgValue: 0n,
        data: encodeFunctionData({
          abi: ROUTER_ABI,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn: args.tokenIn,
              tokenOut: args.tokenOut,
              recipient: args.recipient,
              deadline: args.deadline,
              amountIn: args.amount,
              amountOutMinimum: (amountOut * BigInt(10_000 - args.slippageBps)) / 10_000n,
              limitSqrtPrice: 0n,
            },
          ],
        }),
      });
    },
  );
}

/** The real Lens quoter, with each request it was given kept. Lens is mocked, so the client is never read. */
function recordingLensQuoter(): SwapQuoter & { requests: SwapQuoteRequest[] } {
  const lens = createLensQuoter({} as PublicClient, 100, () => 0);
  const requests: SwapQuoteRequest[] = [];
  return {
    requests,
    quote: (request) => {
      requests.push(request);
      return lens.quote(request);
    },
  };
}

/** Builds the one predict batch for UP's pool and returns the min-out of every swap it signs. */
async function buildUpLeg(args: { pool: PoolLiquidity; targetPriceWad: bigint }) {
  const option: PredictOption = { ...OPTION, targetPriceWad: args.targetPriceWad };
  const quoter = recordingLensQuoter();
  const reader = fakeReader({ state: () => chainState({ pools: { up: args.pool, down: UNPRICED } }) });
  const snap = snapshot({ options: [option], collateralIn: WAD, deposit: WAD });

  const step = planPredict(snap, { reader, quoter, slippageBps: SLIPPAGE_BPS }).find(
    (each) => each.id === STEP_ID.predict(1),
  )!;
  const tx = await step.build(ctx(), snap);

  const batch = decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data! });
  if (batch.functionName !== "batchExecute") throw new Error(`Expected batchExecute, got ${batch.functionName}`);
  const minOuts = batch.args[0]
    .filter((call) => call.to === SWAPR_ROUTER)
    .map((call) => decodeFunctionData({ abi: ROUTER_ABI, data: call.data as Hex }).args[0].amountOutMinimum);

  return { requests: quoter.requests, minOuts };
}

// a leg is offered 1% over what reaching the target takes
const withHeadroom = (amount: bigint) => (amount * 101n) / 100n;
const kept = BigInt(10_000 - SLIPPAGE_BPS);

describe("the min-out each predict leg is signed with", () => {
  beforeEach(() => {
    lensQuote.mockReset();
  });

  it("prices a buy's min-out at its limit on what reaching the target spends, not on the headroom", async () => {
    lensQuotesAt(PRICE["0.25"]);

    const { requests, minOuts } = await buildUpLeg({
      pool: upPool(SQRT["0.25"], FEE["1%"]),
      targetPriceWad: PRICE["16641/65536"],
    });

    // sqrt 2^95 up to 129 * 2^88 takes LIQUIDITY / 256 underlying net, 100/99 of it gross
    const grossIn = ((LIQUIDITY / 256n) * 100n + 98n) / 99n;
    expect(requests).toEqual([
      expect.objectContaining({
        tokenIn: OPTION.underlying,
        tokenOut: OPTION.upToken,
        amount: withHeadroom(grossIn),
        limitSqrtPrice: SQRT["16641/65536"],
        amountInAtLimit: grossIn,
        amountOutAtLimit: (2n * LIQUIDITY) / 129n,
      }),
    ]);
    // the limit prices UP at 16641/65536 underlying
    expect(minOuts).toEqual([(grossIn * 65_536n * kept) / (16_641n * 10_000n)]);
  });

  it("prices a sell's min-out at its limit on what reaching the target spends, not on the headroom", async () => {
    lensQuotesAt(PRICE["16641/65536"]);

    const { requests, minOuts } = await buildUpLeg({
      pool: upPool(SQRT["16641/65536"], FEE["1%"]),
      targetPriceWad: PRICE["0.25"],
    });

    // sqrt 129 * 2^88 down to 2^95 takes 2 * LIQUIDITY / 129 UP net, 100/99 of it gross
    const grossIn = (((2n * LIQUIDITY) / 129n) * 100n + 98n) / 99n;
    expect(requests).toEqual([
      expect.objectContaining({
        tokenIn: OPTION.upToken,
        tokenOut: OPTION.underlying,
        amount: withHeadroom(grossIn),
        limitSqrtPrice: SQRT["0.25"],
        amountInAtLimit: grossIn,
        amountOutAtLimit: LIQUIDITY / 256n,
      }),
    ]);
    // the limit prices UP at a quarter of an underlying
    expect(minOuts).toEqual([(grossIn * kept) / (4n * 10_000n)]);
  });

  it("signs a buy whose fee is just above its move with a min-out the pool still pays at the limit", async () => {
    lensQuotesAt(PRICE["0.25"]);

    const { minOuts } = await buildUpLeg({
      pool: upPool(SQRT["0.25"], FEE["1.7%"]),
      targetPriceWad: PRICE["16641/65536"],
    });

    // a 1.6% move under a 1.7% fee stays inside the slippage plus half the move
    const grossIn = ((LIQUIDITY / 256n) * 1_000n + 982n) / 983n;
    expect(minOuts).toEqual([(grossIn * 65_536n * kept) / (16_641n * 10_000n)]);
    expect(minOuts[0]!).toBeLessThanOrEqual((2n * LIQUIDITY) / 129n);
  });

  it("signs a buy whose fee outweighs its move with a min-out above what the pool pays at the limit", async () => {
    lensQuotesAt(PRICE["0.25"]);

    const { minOuts } = await buildUpLeg({
      pool: upPool(SQRT["0.25"], FEE["3%"]),
      targetPriceWad: PRICE["16641/65536"],
    });

    // a 1.6% move under a 3% fee: the floor prices the fee-inclusive input at the limit, so the
    // router reverts this leg with "Too little received" rather than fill it
    const grossIn = ((LIQUIDITY / 256n) * 100n + 96n) / 97n;
    expect(minOuts).toEqual([(grossIn * 65_536n * kept) / (16_641n * 10_000n)]);
    expect(minOuts[0]!).toBeGreaterThan((2n * LIQUIDITY) / 129n);
  });
});

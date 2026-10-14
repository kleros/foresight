import { decodeFunctionData, encodeFunctionData, parseAbi, type Address, type PublicClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// eslint-disable-next-line import-x/no-restricted-paths -- the predict oracle owns the slippage these legs are signed at
import { SLIPPAGE_BPS } from "@/features/predict/oracle/tolerances";

import { createLensQuoter } from "../lens";
import { NoSwapRouteError, type SwapQuoteRequest } from "../types";

const ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) payable returns (uint256 amountOut)",
  "function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)",
]);

const ROUTER = "0xfFB643E73f280B97809A8b41f7232AB401a04ee1" as Address;
const TOKEN_IN = "0x1111111111111111111111111111111111111111" as Address;
const TOKEN_OUT = "0x2222222222222222222222222222222222222222" as Address;
const EXECUTOR = "0x3333333333333333333333333333333333333333" as Address;

/** What Lens hands back: the whole amount quoted, the min-out at 1% slippage, and no limit. */
const lensResult = { amountIn: 1000n, amountOut: 500n, target: ROUTER, data: "0x", msgValue: 0n };
const quote = vi.fn();

vi.mock("@seer-pm/lens/client", () => ({
  Lens: class {
    quote = quote;
  },
}));

const singleCall = (amountOutMinimum: bigint, tokenIn = TOKEN_IN, tokenOut = TOKEN_OUT, amountIn = 1000n) =>
  encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn,
        tokenOut,
        recipient: EXECUTOR,
        deadline: 1_800n,
        amountIn,
        amountOutMinimum,
        limitSqrtPrice: 0n,
      },
    ],
  });

const request = (overrides: Partial<SwapQuoteRequest> = {}): SwapQuoteRequest => ({
  tokenIn: TOKEN_IN,
  tokenOut: TOKEN_OUT,
  amount: 1000n,
  recipient: EXECUTOR,
  slippageBps: 100,
  limitSqrtPrice: 2n ** 95n,
  amountInAtLimit: 1000n,
  amountOutAtLimit: 400n,
  ...overrides,
});

const quoter = () => createLensQuoter({} as PublicClient, 100, () => Promise.resolve(0n));

const params = (data: `0x${string}`) => {
  const decoded = decodeFunctionData({ abi: ROUTER_ABI, data });
  if (decoded.functionName !== "exactInputSingle")
    throw new Error(`Expected exactInputSingle, got ${decoded.functionName}`);
  return decoded.args[0];
};

describe("createLensQuoter", () => {
  beforeEach(() => {
    quote.mockReset();
    quote.mockResolvedValue({ ...lensResult, data: singleCall(495n) });
  });

  it("dates the deadline from the chain's latest block, not the visitor's clock", async () => {
    const client = { getBlock: () => Promise.resolve({ timestamp: 5_000n }) } as unknown as PublicClient;
    await createLensQuoter(client, 100).quote(request());

    expect(quote).toHaveBeenCalledWith(expect.objectContaining({ deadline: 5_000n + 1_800n }));
  });

  it("signs the swap with the limit it was asked for, leaving the rest of Lens's call as it was", async () => {
    const result = await quoter().quote(request());

    expect(result.router).toBe(ROUTER);
    expect(params(result.data)).toEqual({
      tokenIn: TOKEN_IN,
      tokenOut: TOKEN_OUT,
      recipient: EXECUTOR,
      deadline: 1_800n,
      amountIn: 1000n,
      amountOutMinimum: (495n * 400n) / 500n,
      limitSqrtPrice: 2n ** 95n,
    });
  });

  it("quotes no more out than the swap returns at its limit, and takes min-out down with it", async () => {
    const result = await quoter().quote(request({ amountOutAtLimit: 400n }));

    expect(result.amountOut).toBe(400n);
    expect(params(result.data).amountOutMinimum).toBe(396n);
  });

  it("keeps Lens's own quote and min-out when the limit is further than the amount reaches", async () => {
    const result = await quoter().quote(request({ amountOutAtLimit: 900n }));

    expect(result.amountOut).toBe(500n);
    expect(params(result.data).amountOutMinimum).toBe(495n);
  });

  it("answers no route when the only route's call carries no price limit", async () => {
    const multiHop = encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: "exactInput",
      args: [{ path: "0x", recipient: EXECUTOR, deadline: 1_800n, amountIn: 1000n, amountOutMinimum: 1n }],
    });
    quote.mockResolvedValue({ ...lensResult, data: multiHop });

    const quoted = quoter().quote(request());

    await expect(quoted).rejects.toBeInstanceOf(NoSwapRouteError);
    await expect(quoted).rejects.toThrow(/price limit/);
  });
});

/** Algebra orders a pool's two tokens by address, so the lower one is token0. */
const TOKEN0 = TOKEN_IN;
const TOKEN1 = TOKEN_OUT;

describe("createLensQuoter's min-out floor at the limit price", () => {
  beforeEach(() => quote.mockReset());

  /** Lens's quote for the whole amount, with a tick walk that put the limit's output far too low. */
  function understated(args: {
    tokenIn: Address;
    tokenOut: Address;
    amount: bigint;
    lensOut: bigint;
    limitSqrtPrice: bigint;
    amountInAtLimit: bigint;
    amountOutAtLimit: bigint;
  }) {
    quote.mockResolvedValue({
      amountIn: args.amount,
      amountOut: args.lensOut,
      target: ROUTER,
      data: singleCall((args.lensOut * 99n) / 100n, args.tokenIn, args.tokenOut, args.amount),
      msgValue: 0n,
    });
    return quoter().quote(
      request({
        tokenIn: args.tokenIn,
        tokenOut: args.tokenOut,
        amount: args.amount,
        slippageBps: SLIPPAGE_BPS,
        limitSqrtPrice: args.limitSqrtPrice,
        amountInAtLimit: args.amountInAtLimit,
        amountOutAtLimit: args.amountOutAtLimit,
      }),
    );
  }

  it("holds a buy of an outcome that is token0 to its limit price", async () => {
    // underlying (token1) in; the limit 2^95 prices token0 at 1/4 token1, so 1000 in buys at least 4000
    const result = await understated({
      tokenIn: TOKEN1,
      tokenOut: TOKEN0,
      amount: 1010n,
      lensOut: 5000n,
      limitSqrtPrice: 2n ** 95n,
      amountInAtLimit: 1000n,
      amountOutAtLimit: 100n,
    });

    expect(params(result.data).amountOutMinimum).toBe((1000n * 4n * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n);
  });

  it("holds a buy of an outcome that is token1 to its limit price", async () => {
    // underlying (token0) in; the limit 2^97 prices token0 at 4 token1, so 1000 in buys at least 4000
    const result = await understated({
      tokenIn: TOKEN0,
      tokenOut: TOKEN1,
      amount: 1010n,
      lensOut: 5000n,
      limitSqrtPrice: 2n ** 97n,
      amountInAtLimit: 1000n,
      amountOutAtLimit: 100n,
    });

    expect(params(result.data).amountOutMinimum).toBe((1000n * 4n * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n);
  });

  it("holds a sell of an outcome that is token0 to its limit price", async () => {
    // outcome (token0) in; the limit 2^95 prices it at 1/4 token1, so all 1000 sold pay at least 250
    const result = await understated({
      tokenIn: TOKEN0,
      tokenOut: TOKEN1,
      amount: 1000n,
      lensOut: 500n,
      limitSqrtPrice: 2n ** 95n,
      amountInAtLimit: 5000n,
      amountOutAtLimit: 2n,
    });

    expect(params(result.data).amountOutMinimum).toBe((1000n * BigInt(10_000 - SLIPPAGE_BPS)) / (4n * 10_000n));
  });

  it("holds a sell of an outcome that is token1 to its limit price", async () => {
    // outcome (token1) in; the limit 2^97 prices token0 at 4 token1, so all 1000 sold pay at least 250
    const result = await understated({
      tokenIn: TOKEN1,
      tokenOut: TOKEN0,
      amount: 1000n,
      lensOut: 500n,
      limitSqrtPrice: 2n ** 97n,
      amountInAtLimit: 5000n,
      amountOutAtLimit: 2n,
    });

    expect(params(result.data).amountOutMinimum).toBe((1000n * BigInt(10_000 - SLIPPAGE_BPS)) / (4n * 10_000n));
  });
});

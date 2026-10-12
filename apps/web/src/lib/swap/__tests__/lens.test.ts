import { decodeFunctionData, encodeFunctionData, parseAbi, type Address, type PublicClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createLensQuoter } from "../lens";
import type { SwapQuoteRequest } from "../types";

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

const singleCall = (amountOutMinimum: bigint) =>
  encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: TOKEN_IN,
        tokenOut: TOKEN_OUT,
        recipient: EXECUTOR,
        deadline: 1_800n,
        amountIn: 1000n,
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
  amountOutAtLimit: 400n,
  ...overrides,
});

const quoter = () => createLensQuoter({} as PublicClient, 100, () => 0);

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

  it("refuses a route whose call carries no price limit", async () => {
    const multiHop = encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: "exactInput",
      args: [{ path: "0x", recipient: EXECUTOR, deadline: 1_800n, amountIn: 1000n, amountOutMinimum: 1n }],
    });
    quote.mockResolvedValue({ ...lensResult, data: multiHop });

    await expect(quoter().quote(request())).rejects.toThrow(/price limit/);
  });
});

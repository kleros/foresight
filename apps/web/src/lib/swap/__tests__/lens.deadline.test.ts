import { encodeFunctionData, parseAbi, decodeFunctionData, type Address, type PublicClient } from "viem";
import { expect, it, vi } from "vitest";

import { createLensQuoter } from "../lens";

const ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) payable returns (uint256 amountOut)",
]);
const ROUTER = "0xfFB643E73f280B97809A8b41f7232AB401a04ee1" as Address;
const TOKEN_IN = "0x1111111111111111111111111111111111111111" as Address;
const TOKEN_OUT = "0x2222222222222222222222222222222222222222" as Address;
const EXECUTOR = "0x3333333333333333333333333333333333333333" as Address;

// one figure for how long a quote stays valid, wherever it is read
vi.mock("../deadline", () => ({ QUOTE_DEADLINE_SECONDS: 60n }));

vi.mock("@seer-pm/lens/client", () => ({
  Lens: class {
    quote = () =>
      Promise.resolve({
        amountIn: 1000n,
        amountOut: 500n,
        target: ROUTER,
        msgValue: 0n,
        data: encodeFunctionData({
          abi: ROUTER_ABI,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn: TOKEN_IN,
              tokenOut: TOKEN_OUT,
              recipient: EXECUTOR,
              deadline: 1n,
              amountIn: 1000n,
              amountOutMinimum: 0n,
              limitSqrtPrice: 0n,
            },
          ],
        }),
      });
  },
}));

it("signs the deadline the shared quote validity sets", async () => {
  const result = await createLensQuoter({} as PublicClient, 100, () => Promise.resolve(0n)).quote({
    tokenIn: TOKEN_IN,
    tokenOut: TOKEN_OUT,
    amount: 1000n,
    recipient: EXECUTOR,
    slippageBps: 100,
    limitSqrtPrice: 2n ** 95n,
    amountInAtLimit: 1000n,
    amountOutAtLimit: 400n,
    poolFee: 0n,
  });

  const decoded = decodeFunctionData({ abi: ROUTER_ABI, data: result.data });
  expect(decoded.args[0].deadline).toBe(60n);
});

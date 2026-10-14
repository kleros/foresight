import type { Address } from "viem";
import { describe, expect, it } from "vitest";

import { NoSwapRouteError, type SwapQuoteRequest } from "../types";
import { lensQuoterOn, nodeAnswers, type NodeAnswer } from "./support/lensNode";

const request: SwapQuoteRequest = {
  tokenIn: "0x1111111111111111111111111111111111111111" as Address,
  tokenOut: "0x2222222222222222222222222222222222222222" as Address,
  amount: 1000n,
  recipient: "0x3333333333333333333333333333333333333333" as Address,
  slippageBps: 100,
  limitSqrtPrice: 2n ** 95n,
  amountInAtLimit: 1000n,
  amountOutAtLimit: 400n,
};

const quoteFrom = (answer: NodeAnswer) =>
  lensQuoterOn(answer)
    .quote(request)
    .catch((error: unknown) => error);

describe("createLensQuoter, against Seer's Lens client over a node", () => {
  it.each([
    ["NoRoute", nodeAnswers.noRoute],
    ["ZeroAmount", nodeAnswers.zeroAmount],
    ["UnsupportedAMM", nodeAnswers.unsupportedAmm],
  ])("answers that no route exists when the quoter reverts with %s()", async (_, answer) => {
    expect(await quoteFrom(answer)).toBeInstanceOf(NoSwapRouteError);
  });

  it.each([
    ["the routed swap reverts when simulated", nodeAnswers.swapReverts],
    ["the routed swap needs more gas than a block allows", nodeAnswers.thinPool],
  ])("answers that no route exists when %s", async (_, answer) => {
    expect(await quoteFrom(answer)).toBeInstanceOf(NoSwapRouteError);
  });

  it.each([
    ["the node cannot be reached", nodeAnswers.unreachable],
    ["the address has no code", nodeAnswers.noCode],
    ["the call reverts with no reason", nodeAnswers.bareRevert],
  ])("fails rather than answering no route when %s", async (_, answer) => {
    const error = await quoteFrom(answer);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NoSwapRouteError);
  });
});

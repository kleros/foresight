import { decodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import type { SwapQuote, SwapQuoter } from "@/lib/swap/types";

import { gnosisRouterAbi, tradeExecutorAbi } from "@/config/contracts";

import { planPredict, STEP_ID } from "../plan";
import type { OptionChainState, PredictOption } from "../types";
import { addresses, AT, chainState, ctx, DEEP, fakeQuoter, fakeReader, option, snapshot } from "./support/fakes";

/** A quoter that remembers each quote by its calldata, so a swap in the batch can be traced to it. */
function recordingQuoter(): SwapQuoter & { byData: Map<Hex, SwapQuote> } {
  const inner = fakeQuoter();
  const byData = new Map<Hex, SwapQuote>();
  return {
    byData,
    async quote(request) {
      const quote = await inner.quote(request);
      byData.set(quote.data, quote);
      return quote;
    },
  };
}

/** The least a swap may return before it reverts: the quote less the slippage the run allows. */
const worstFill = (quote: SwapQuote, slippageBps: number): bigint =>
  (quote.amountOut * BigInt(10_000 - slippageBps)) / 10_000n;

interface Ledger {
  /** Each option's underlying held by the executor, at the lowest point the batch reached. */
  lowest: Map<Address, bigint>;
  buys: number;
}

/**
 * Replays a predict batch against the executor's underlying balances, with every sell paying its
 * minimum and every buy spending the amount it approved.
 */
function replayWorstCase(
  data: Hex,
  options: PredictOption[],
  states: OptionChainState[],
  quotes: Map<Hex, SwapQuote>,
  slippageBps: number,
): Ledger {
  const underlyingOf = new Map(options.map((each) => [each.childMarket.toLowerCase(), each.underlying]));
  const isUnderlying = new Set(options.map((each) => each.underlying.toLowerCase()));
  const balance = new Map(options.map((each, index) => [each.underlying, states[index]!.underlying]));
  const lowest = new Map(balance);
  let pendingBuy = 0n;
  let buys = 0;

  const move = (token: Address, delta: bigint) => {
    const next = balance.get(token)! + delta;
    balance.set(token, next);
    if (next < lowest.get(token)!) lowest.set(token, next);
  };

  const decoded = decodeFunctionData({ abi: tradeExecutorAbi, data });
  if (decoded.functionName !== "batchExecute") throw new Error(`Expected batchExecute, got ${decoded.functionName}`);

  for (const call of decoded.args[0]) {
    if (call.to === addresses.swapRouter) {
      const quote = quotes.get(call.data);
      if (quote === undefined) throw new Error(`A swap in the batch was never quoted: ${call.data}`);
      if (pendingBuy > 0n) {
        buys += 1;
        pendingBuy = 0n;
        continue;
      }
      const tokenOut = `0x${call.data.slice(42, 82)}` as Address;
      const underlying = options.find((each) => each.underlying.toLowerCase() === tokenOut.toLowerCase())!.underlying;
      move(underlying, worstFill(quote, slippageBps));
      continue;
    }

    if (isUnderlying.has(call.to.toLowerCase())) {
      const approve = decodeFunctionData({ abi: erc20Abi, data: call.data });
      const [spender, amount] = approve.args as readonly [Address, bigint];
      if (spender === addresses.swapRouter && amount > 0n) {
        pendingBuy = amount;
        move(options.find((each) => each.underlying.toLowerCase() === call.to.toLowerCase())!.underlying, -amount);
      }
      continue;
    }

    if (call.to === addresses.router) {
      const router = decodeFunctionData({ abi: gnosisRouterAbi, data: call.data });
      if (router.functionName !== "splitPosition" && router.functionName !== "mergePositions") continue;
      const [, market, amount] = router.args as readonly [Address, Address, bigint];
      if (market === addresses.parentMarket) {
        for (const each of options) move(each.underlying, amount);
        continue;
      }
      const underlying = underlyingOf.get(market.toLowerCase())!;
      move(underlying, router.functionName === "splitPosition" ? -amount : amount);
    }
  }

  return { lowest, buys };
}

/** UP far above its target in a deep pool, so the sell takes every UP token and leaves nothing to merge. */
const sellsEverything = (): OptionChainState =>
  chainState({
    pools: {
      up: { sqrtPriceX96: AT["1"], liquidity: DEEP, tick: 0, fee: 0n, ticks: [], outcomeIsToken0: true },
      down: { sqrtPriceX96: AT["0.25"], liquidity: DEEP, tick: 0, fee: 0n, ticks: [], outcomeIsToken0: true },
    },
  });

async function buildWorstCase(args: { slippageBps: number; options: PredictOption[]; state: () => OptionChainState }) {
  const quoter = recordingQuoter();
  const states = args.options.map(() => args.state());
  const snap = snapshot({ options: args.options });
  const deps = { reader: fakeReader({ state: args.state }), quoter, slippageBps: args.slippageBps };

  const step = planPredict(snap, deps).find((each) => each.id === STEP_ID.predict(1))!;
  const tx = await step.build(ctx(), snap);

  return replayWorstCase(tx.data!, args.options, states, quoter.byData, args.slippageBps);
}

describe("the buys a batch can afford when every sell fills at its minimum", () => {
  const cases = [
    { name: "a sell that leaves nothing to merge", options: [option(1)], state: sellsEverything },
    { name: "a sell that leaves pairs to merge", options: [option(1)], state: () => chainState() },
    { name: "two options in one batch", options: [option(1), option(2)], state: sellsEverything },
  ];

  for (const slippageBps of [100, 300]) {
    for (const { name, options, state } of cases) {
      it(`never spends underlying the executor does not hold, at ${slippageBps / 100}% slippage: ${name}`, async () => {
        const { lowest, buys } = await buildWorstCase({ slippageBps, options, state });

        expect(buys).toBeGreaterThan(0);
        for (const each of options) {
          expect(lowest.get(each.underlying)!).toBeGreaterThanOrEqual(0n);
        }
      });
    }
  }
});

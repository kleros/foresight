import { type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import {
  decodeFunctionData,
  encodeFunctionData,
  type Address,
  type Hash,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { describe, expect, it, vi } from "vitest";

import { addresses, ctx, fakeReader, snapshot, WAD } from "@/features/predict/flow/__tests__/support/fakes";
import { departures, sessionTokensOf } from "@/features/predict/flow/allowed";
import type { OptionChainState, PredictOption } from "@/features/predict/flow/types";
import { createPredictRun } from "@/features/predict/run/driver";
import { previewTrades } from "@/features/predict/utils/plan";
import { sqrtPriceX96FromPrice, swapToward } from "@/features/predict/utils/poolMath";

import { ALGEBRA_ROUTER_ABI } from "@/lib/swap/algebraRouter";
import { createLensQuoter } from "@/lib/swap/lens";
import { tickAtSqrtPrice } from "@/lib/swap/tickMath";

import { tradeExecutorAbi } from "@/config/contracts";

const lensQuote = vi.hoisted(() => vi.fn());
vi.mock("@seer-pm/lens/client", async (original) => ({
  ...(await original<typeof import("@seer-pm/lens/client")>()),
  Lens: class {
    quote = lensQuote;
  },
}));

const option: PredictOption = {
  childMarket: "0x0100000000000000000000000000000000000001",
  upToken: "0x0300000000000000000000000000000000000003",
  downToken: "0x0400000000000000000000000000000000000004",
  invalidToken: "0x0500000000000000000000000000000000000005",
  underlying: "0x0900000000000000000000000000000000000009",
  targetPriceWad: (WAD * 3n) / 4n,
};
const pool = (price: bigint) => ({
  sqrtPriceX96: sqrtPriceX96FromPrice(price, true),
  liquidity: 10000n * WAD,
  tick: tickAtSqrtPrice(sqrtPriceX96FromPrice(price, true)),
  ticks: [],
  fee: 1000n,
  outcomeIsToken0: true,
});
const shownState: OptionChainState = {
  pools: { up: pool(WAD / 4n), down: pool(WAD / 2n) },
  held: { up: 0n, down: 0n, invalid: 0n },
  underlying: 0n,
};
const liveState: OptionChainState = {
  ...shownState,
  pools: { up: pool((WAD * 3n) / 10n), down: pool((WAD * 6n) / 10n) },
};

describe("held quotes when a better sell funds a larger buy", () => {
  it.each([
    { moves: false, name: "keeps the shown input and scaled minimum when pools do not move" },
    { moves: true, name: "requires confirmation when a larger buy pays below the confirmed rate" },
  ])("$name", async ({ moves }) => {
    const run = snapshot({ options: [option], collateralIn: 100n * WAD, deposit: 100n * WAD });
    const shown = previewTrades(
      {
        pools: shownState.pools,
        held: shownState.held,
        targetPriceWad: option.targetPriceWad,
        splitAmount: run.collateralIn,
      },
      run.slippage.tradeBps,
    )!;

    let quoteState = shownState;
    lensQuote.mockImplementation(
      async (request: {
        tokenIn: Address;
        tokenOut: Address;
        amount: bigint;
        recipient: Address;
        deadline: bigint;
      }) => {
        const side = request.tokenIn === option.downToken ? "down" : "up";
        const target = side === "up" ? option.targetPriceWad : WAD - option.targetPriceWad;
        const { amountOut } = swapToward(quoteState.pools[side], target, request.amount);
        return {
          amountIn: request.amount,
          amountOut,
          target: addresses.swapRouter,
          msgValue: 0n,
          data: encodeFunctionData({
            abi: ALGEBRA_ROUTER_ABI,
            functionName: "exactInputSingle",
            args: [
              {
                tokenIn: request.tokenIn,
                tokenOut: request.tokenOut,
                recipient: request.recipient,
                amountIn: request.amount,
                deadline: request.deadline,
                amountOutMinimum: 0n,
                limitSqrtPrice: 0n,
              },
            ],
          }),
        };
      },
    );
    const sends: FlowTx[] = [];
    const receipt = (hash: Hash) =>
      ({ transactionHash: hash, status: "success", blockNumber: 2n, logs: [] }) as unknown as TransactionReceipt;
    const gateway: TxGateway = {
      sendTransaction: async (tx) => {
        sends.push(tx);
        return `0x${sends.length.toString(16).padStart(64, "0")}` as Hash;
      },
      waitForReceipt: async ({ hash }) => receipt(hash),
      getReceipt: async (hash) => receipt(hash),
      isKnown: async () => true,
    };
    const reader = fakeReader({ deployed: true, state: () => shownState });
    const readStates = reader.optionStates;
    reader.optionStates = async (args) => {
      const states = await readStates(args);
      // Preflight sees the preview; another trade lands after the final build reads its pools.
      if (moves && reader.asked.length === 3) quoteState = liveState;
      return states;
    };
    const quoteRequests: import("@/lib/swap/types").SwapQuoteRequest[] = [];
    const lens = createLensQuoter({} as PublicClient, 100, async () => 100n);
    const driver = createPredictRun({
      gateway,
      reader,
      quoter: {
        quote: (request) => {
          quoteRequests.push(request);
          return lens.quote(request);
        },
      },
      flowId: "held-input",
      ctx: () => ctx(),
      snapshot: () => run,
    });
    try {
      driver.start({ plans: {} });
      await vi.waitFor(() => expect(driver.getProgress().stage).toBe("moved"));
      expect(driver.getProgress().moved?.plans[option.childMarket.toLowerCase()]).toEqual(shown);
      expect(sends).toHaveLength(0);
      driver.confirm();
      if (moves) {
        await vi.waitFor(() => expect(driver.getProgress().stage).toBe("moved"));
        expect(sends).toHaveLength(1);
        const buy = [...quoteRequests].reverse().find((request) => request.tokenIn === option.underlying)!;
        const before = shown.buys[0]!;
        expect(buy.amount).toBeGreaterThan(before.amountIn);
        expect(buy.heldOut).toBe((before.outcomeOut * buy.amount) / before.amountIn);
        return;
      }
      await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));
      expect(sends).toHaveLength(2);
      const tx = sends[1]!;
      expect(
        departures({ tx, ctx: ctx(), sessionTokens: sessionTokensOf(ctx(), [option]), from: addresses.owner }),
      ).toEqual([]);
      const batch = decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data! });
      if (batch.functionName !== "batchExecute") throw new Error("Not a prediction batch");
      const swaps = batch.args[0]
        .filter((call) => call.to.toLowerCase() === addresses.swapRouter.toLowerCase())
        .map((call) => decodeFunctionData({ abi: ALGEBRA_ROUTER_ABI, data: call.data }).args[0]);
      const buy = swaps.find((swap) => swap.tokenIn.toLowerCase() === option.underlying.toLowerCase())!;
      const before = shown.buys[0]!;
      const required = (((before.outcomeOut * buy.amountIn) / before.amountIn) * 9900n) / 10000n;
      const fill = swapToward(quoteState.pools.up, option.targetPriceWad, buy.amountIn).amountOut;
      expect(fill).toBeGreaterThanOrEqual(buy.amountOutMinimum);
      expect(buy.amountIn).toBe(before.amountIn);
      expect(buy.amountOutMinimum).toBeGreaterThanOrEqual(required);
    } finally {
      driver.dispose();
    }
  });
});

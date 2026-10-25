import { createFlowRunStore, createMemoryStorage, type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import {
  decodeFunctionData,
  encodeFunctionData,
  type Address,
  type Hash,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { expect, it, vi } from "vitest";

import { addresses, ctx, fakeReader, snapshot, WAD } from "@/features/predict/flow/__tests__/support/fakes";
import { createPredictRun } from "@/features/predict/run/driver";
import { createPredictReader } from "@/features/predict/run/reader";
import { previewTrades } from "@/features/predict/utils/plan";
import { priceFromSqrtPriceX96, sqrtPriceX96FromPrice } from "@/features/predict/utils/poolMath";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { ALGEBRA_ROUTER_ABI } from "@/lib/swap/algebraRouter";
import { createLensQuoter } from "@/lib/swap/lens";
import { executorAddress } from "@/lib/trade-executor/executor";

import { tradeExecutorAbi } from "@/config/contracts";

vi.mock("@/config/chains", () => ({ DEFAULT_CHAIN_ID: 100 }));
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
const lensAnswer = vi.hoisted(() => vi.fn());
vi.mock("@seer-pm/lens/client", () => ({
  Lens: class {
    quote = lensAnswer;
  },
}));

it("resolves canonical pools and preserves the reviewed cap despite forged indexed orientation", async () => {
  const childMarket = "0x1111111111111111111111111111111111111111" as Address;
  const upToken = "0x2222222222222222222222222222222222222222" as Address;
  const underlying = "0x3333333333333333333333333333333333333333" as Address;
  const downToken = "0x4444444444444444444444444444444444444444" as Address;
  const invalidToken = "0x5555555555555555555555555555555555555555" as Address;
  const canonicalUp = "0x8888888888888888888888888888888888888888" as Address;
  const otherPool = "0x6666666666666666666666666666666666666666" as Address;
  const downPool = "0x7777777777777777777777777777777777777777" as Address;
  const executor = executorAddress(addresses.factory, addresses.owner);
  const option = { childMarket, upToken, underlying, downToken, invalidToken, targetPriceWad: WAD / 2n };
  expect(BigInt(upToken) < BigInt(underlying)).toBe(true);
  vi.mocked(fetchGraphql).mockResolvedValue({
    Pool: [
      { id: otherPool, childMarket_id: childMarket, outcomeIndex: 1, outcomeIsToken0: false },
      { id: downPool, childMarket_id: childMarket, outcomeIndex: 0, outcomeIsToken0: false },
    ],
  });
  const readContract = vi.fn(
    async ({ address, functionName, args }: { address: Address; functionName: string; args?: readonly Address[] }) => {
      if (functionName === "poolByPair") return args?.includes(upToken) ? canonicalUp : downPool;
      if (functionName === "token0") return address === canonicalUp ? upToken : underlying;
      if (functionName === "token1") return address === canonicalUp ? underlying : downToken;
      if (functionName === "balanceOf") return 0n;
      if (functionName === "liquidity") return WAD;
      if (functionName === "globalState")
        return [
          address === otherPool
            ? 2n ** 97n
            : address === canonicalUp
              ? sqrtPriceX96FromPrice(WAD / 4n, true)
              : sqrtPriceX96FromPrice(WAD / 2n, false),
          0,
          0,
          0,
          0,
          0,
          true,
        ];
      throw new Error(`unexpected read ${functionName}`);
    },
  );
  const client = {
    readContract,
    multicall: async ({ contracts }: { contracts: unknown[] }) => contracts.map(() => 0n),
  } as unknown as PublicClient;
  const chainReader = createPredictReader({ client, sessionId: "1", collateral: addresses.collateral });
  const reader = { ...fakeReader({ deployed: true }), optionStates: chainReader.optionStates };
  const [state] = await reader.optionStates({ options: [option], executor });
  const shown = previewTrades(
    { pools: state!.pools, targetPriceWad: option.targetPriceWad, held: state!.held, splitAmount: WAD },
    100,
  )!;
  expect(shown).not.toBeNull();
  lensAnswer.mockImplementation(
    async (request: { tokenIn: Address; tokenOut: Address; recipient: Address; amount: bigint; deadline: bigint }) => ({
      amountIn: request.amount,
      amountOut: request.amount * 10n,
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
    }),
  );
  const sends: FlowTx[] = [];
  const receipt = (hash: Hash) =>
    ({ transactionHash: hash, status: "success", blockNumber: 1n, logs: [] }) as unknown as TransactionReceipt;
  const gateway: TxGateway = {
    sendTransaction: async (tx) => {
      sends.push(tx);
      return `0x${sends.length.toString().padStart(64, "0")}` as Hash;
    },
    waitForReceipt: async ({ hash }) => receipt(hash),
    getReceipt: async (hash) => receipt(hash),
    isKnown: async () => true,
  };
  const driver = createPredictRun({
    gateway,
    reader,
    quoter: createLensQuoter(client, 100, async () => 0n),
    flowId: "verified-orientation",
    store: createFlowRunStore({ storage: createMemoryStorage() }),
    ctx: () => ctx({ executor }),
    snapshot: () => snapshot({ options: [option] }),
  });
  try {
    driver.start({ plans: { [childMarket]: shown } });
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));
    const batch = decodeFunctionData({ abi: tradeExecutorAbi, data: sends.at(-1)!.data! });
    expect(batch.functionName).toBe("batchExecute");
    const swapCall = (batch.args![0] as readonly { to: Address; data: `0x${string}` }[]).find(
      (call) => call.to.toLowerCase() === addresses.swapRouter.toLowerCase(),
    )!;
    const [swap] = decodeFunctionData({ abi: ALGEBRA_ROUTER_ABI, data: swapCall.data }).args;
    expect(swap.tokenIn).toBe(underlying);
    expect(swap.tokenOut).toBe(upToken);
    const signedCap = priceFromSqrtPriceX96(swap.limitSqrtPrice, true);
    expect(signedCap).toBeLessThanOrEqual(option.targetPriceWad);
    expect(option.targetPriceWad - signedCap).toBeLessThan(2n);
    expect(readContract.mock.calls.some(([call]) => call.address === otherPool)).toBe(false);
    expect(readContract.mock.calls.filter(([call]) => call.functionName === "poolByPair")).toHaveLength(2);
  } finally {
    driver.dispose();
  }
});

import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  multicall3Abi,
  RpcRequestError,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { gnosis } from "viem/chains";
import { describe, expect, it, vi } from "vitest";

import { executorAddress } from "@/lib/trade-executor/executor";

import { tradeExecutorFactoryAddress } from "@/config/contracts";

import { createChain, owner, Q96, sortPair, type Chain } from "../../api/__tests__/support/chain";
import { CHAIN_TIME, fullRange } from "../../flow/__tests__/support/session";
import { useSessionLiquidity } from "../useSessionLiquidity";

const current = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/web3/public-client", () => ({
  get publicClient() {
    return current.client;
  },
}));
vi.mock("@/config/chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/chains")>()),
  DEFAULT_CHAIN_ID: 100,
}));
vi.mock("wagmi", async (importOriginal) => {
  const { owner: connected } = await import("../../api/__tests__/support/chain");
  return {
    ...(await importOriginal<typeof import("wagmi")>()),
    useAccount: () => ({ address: connected, chainId: 100, isConnected: true, status: "connected" }),
  };
});

const WAD = 10n ** 18n;
const tradeWallet = executorAddress(tradeExecutorFactoryAddress(100)!, owner);
const needle = tradeWallet.slice(2).toLowerCase();

/** The fake chain's client, failing each call that names the trade wallet while `failing.on`. */
function clientOf(chain: Chain, failing: { on: boolean }) {
  const one = async (to: Address, data: Hex, from?: Address): Promise<Hex> => {
    if (failing.on && data.toLowerCase().includes(needle)) throw new Error("refused");
    return (await chain.client.request({ method: "eth_call", params: [{ to, data, from }, "latest"] } as never)) as Hex;
  };
  return createPublicClient({
    chain: gnosis,
    batch: { multicall: true },
    transport: custom({
      request: async ({ method, params }: { method: string; params?: unknown }) => {
        if (method === "eth_getBlockByNumber") {
          return {
            number: toHex(19_000_000n),
            hash: `0x${"11".repeat(32)}`,
            timestamp: toHex(CHAIN_TIME),
            transactions: [],
          };
        }
        if (method !== "eth_call") return chain.client.request({ method, params } as never);
        const [{ to, data, from }] = params as [{ to: Address; data: Hex; from?: Address }];
        if (to.toLowerCase() === gnosis.contracts.multicall3.address.toLowerCase()) {
          const decoded = decodeFunctionData({ abi: multicall3Abi, data });
          if (decoded.functionName !== "aggregate3") throw new Error("unexpected");
          const results = await Promise.all(
            decoded.args[0].map(async (each) => {
              try {
                return { success: true, returnData: await one(each.target, each.callData) };
              } catch {
                return { success: false, returnData: "0x" as Hex };
              }
            }),
          );
          return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results });
        }
        try {
          return await one(to, data, from);
        } catch {
          throw new RpcRequestError({
            body: { method, params },
            error: { code: 3, message: "execution reverted" },
            url: "fake",
          });
        }
      },
    }),
  });
}

function twoHolders() {
  const chain = createChain(2);
  const [first] = chain.branches as [Chain["branches"][0]];
  chain.setPool(first.upToken, first.outcome, { sqrtPriceX96: Q96, liquidity: 100n * WAD, tickSpacing: 60 });
  chain.setPool(first.downToken, first.outcome, { sqrtPriceX96: Q96, liquidity: 100n * WAD, tickSpacing: 60 });
  const [up0, up1] = sortPair(first.upToken, first.outcome);
  const [down0, down1] = sortPair(first.downToken, first.outcome);
  chain.holdPosition(owner, { tokenId: 7n, token0: up0, token1: up1, ...fullRange(60), liquidity: 5n * WAD });
  chain.holdPosition(tradeWallet, { tokenId: 8n, token0: down0, token1: down1, ...fullRange(60), liquidity: 5n * WAD });
  return chain;
}

function renderOn(
  chain: Chain,
  failing: { on: boolean },
  executor: Pick<
    Parameters<typeof useSessionLiquidity>[0],
    "tradeWallet" | "tradeWalletUnread" | "rereadTradeWallet"
  > = {
    tradeWallet: { predicted: tradeWallet, deployed: tradeWallet },
  },
) {
  current.client = clientOf(chain, failing);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const branches = chain.markets.childMarkets.map((market, outcomeIndex) => ({
    market,
    outcomeIndex,
    name: `Option ${outcomeIndex}`,
  }));
  return renderHook(
    () =>
      useSessionLiquidity({
        parentMarket: chain.markets.parentMarket,
        branches,
        closesAt: null,
        isReady: true,
        ...executor,
      }),
    { wrapper },
  );
}

const held = (rows: { heldBy?: string }[]) => rows.map((row) => row.heldBy);

describe("useSessionLiquidity when the trade wallet cannot be read", () => {
  it("says the positions could not be read when the trade wallet's positions cannot be", async () => {
    const failing = { on: true };
    const { result } = renderOn(twoHolders(), failing);

    await waitFor(() => expect(held(result.current.positions)).toEqual(["wallet"]));
    await waitFor(() => expect(result.current.positionsUnread).toBe(true));
  });

  it("lists the trade wallet's positions once Read again succeeds", async () => {
    const failing = { on: true };
    const { result } = renderOn(twoHolders(), failing);
    await waitFor(() => expect(held(result.current.positions)).toEqual(["wallet"]));
    await waitFor(() => expect(result.current.positionsUnread).toBe(true));

    failing.on = false;
    act(() => result.current.rereadPositions());

    await waitFor(() => expect(held(result.current.positions)).toEqual(["wallet", "tradeWallet"]));
  });

  it("says the positions could not be read when the trade wallet's state cannot be, and reads it again", async () => {
    const rereadTradeWallet = vi.fn();
    const { result } = renderOn(twoHolders(), { on: false }, { tradeWalletUnread: true, rereadTradeWallet });
    await waitFor(() => expect(held(result.current.positions)).toEqual(["wallet"]));
    expect(result.current.positionsUnread).toBe(true);

    act(() => result.current.rereadPositions());

    expect(rereadTradeWallet).toHaveBeenCalledOnce();
  });

  it("leaves the trade wallet's state alone on Read again when it was read", async () => {
    const rereadTradeWallet = vi.fn();
    const { result } = renderOn(
      twoHolders(),
      { on: false },
      { tradeWallet: { predicted: tradeWallet, deployed: null }, rereadTradeWallet },
    );
    await waitFor(() => expect(held(result.current.positions)).toEqual(["wallet"]));
    expect(result.current.positionsUnread).toBe(false);

    act(() => result.current.rereadPositions());

    expect(rereadTradeWallet).not.toHaveBeenCalled();
  });
});

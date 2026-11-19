import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createPublicClient, custom, isAddressEqual, toHex, type Address } from "viem";
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

/**
 * The fake chain's client, also answering `eth_getBlockByNumber` with a block at CHAIN_TIME, which the fake does not.
 * Hand-written: viem formats the JSON-RPC block it gets back, so only the fields it reads are given.
 */
function clientOf(chain: Chain) {
  return createPublicClient({
    chain: gnosis,
    batch: { multicall: true },
    transport: custom({
      request: async ({ method, params }: { method: string; params?: unknown }) =>
        method === "eth_getBlockByNumber"
          ? { number: toHex(19_000_000n), hash: `0x${"11".repeat(32)}`, timestamp: toHex(CHAIN_TIME), transactions: [] }
          : chain.client.request({ method, params } as never),
    }),
  });
}

/** Branch 0's UP and DOWN pools live at price 1; the wallet holds 7 in the UP pool, `holder` holds 8 in the DOWN pool. */
function twoHolders(holder: Address) {
  const chain = createChain(2);
  const [first] = chain.branches as [Chain["branches"][0]];
  chain.setPool(first.upToken, first.outcome, { sqrtPriceX96: Q96, liquidity: 100n * WAD, tickSpacing: 60 });
  chain.setPool(first.downToken, first.outcome, { sqrtPriceX96: Q96, liquidity: 100n * WAD, tickSpacing: 60 });
  const [up0, up1] = sortPair(first.upToken, first.outcome);
  const [down0, down1] = sortPair(first.downToken, first.outcome);
  chain.holdPosition(owner, { tokenId: 7n, token0: up0, token1: up1, ...fullRange(60), liquidity: 5n * WAD });
  chain.holdPosition(holder, { tokenId: 8n, token0: down0, token1: down1, ...fullRange(60), liquidity: 5n * WAD });
  return chain;
}

function renderOn(chain: Chain, executor: { predicted: Address; deployed: Address | null }) {
  current.client = clientOf(chain);
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
        tradeWallet: executor,
      }),
    { wrapper },
  );
}

const listed = (rows: { heldBy?: string; request: { kind: string; input?: unknown } }[]) =>
  rows.map((row) => [
    row.heldBy,
    row.request.kind === "remove"
      ? (row.request.input as { positions: { tokenId: bigint }[] }).positions.map((each) => each.tokenId)
      : [],
  ]);

describe("useSessionLiquidity with a trade wallet", () => {
  it("lists the wallet's positions, then the deployed trade wallet's, each by who holds it", async () => {
    const chain = twoHolders(tradeWallet);

    const { result } = renderOn(chain, { predicted: tradeWallet, deployed: tradeWallet });

    await waitFor(() =>
      expect(listed(result.current.positions)).toEqual([
        ["wallet", [7n]],
        ["tradeWallet", [8n]],
      ]),
    );
    const row = result.current.positions[1]!;
    if (row.request.kind !== "remove") throw new Error("not a remove");
    expect(row.request.input.tradeWallet).toBe(tradeWallet);
  });

  it("reads no positions of a trade wallet not yet deployed, listing the wallet's alone", async () => {
    const chain = twoHolders(tradeWallet);

    const { result } = renderOn(chain, { predicted: tradeWallet, deployed: null });

    await waitFor(() => expect(listed(result.current.positions)).toEqual([["wallet", [7n]]]));
    expect(result.current.positionsUnread).toBe(false);
    const askedOf = chain.calls.filter(
      (call) =>
        (call.functionName === "balanceOf" || call.functionName === "tokenOfOwnerByIndex") &&
        typeof call.args[0] === "string" &&
        isAddressEqual(call.args[0] as Address, tradeWallet),
    );
    expect(askedOf).toEqual([]);
  });
});

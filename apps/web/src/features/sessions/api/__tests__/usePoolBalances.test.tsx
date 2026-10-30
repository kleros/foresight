import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { parseEther, RpcRequestError, type Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionPool } from "../../types";
import { usePoolBalances } from "../getPoolBalances";
import { sessionStatsKey } from "../getSessionStats";

/** The ERC20 balances behind `publicClient.multicall`, keyed `token|holder`; `down` fails every read. */
const chain = vi.hoisted(() => ({ balances: new Map<string, bigint>(), down: false }));
vi.mock("@/lib/web3/public-client", () => ({
  publicClient: {
    multicall: async ({ contracts }: { contracts: { address: Address; args: readonly [Address] }[] }) => {
      if (chain.down) {
        throw new RpcRequestError({ body: {}, error: { code: -32603, message: "internal error" }, url: "fake" });
      }
      return contracts.map(({ address, args: [holder] }) => chain.balances.get(`${address}|${holder}`) ?? 0n);
    },
  },
}));
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));

const SESSION_ID = "1";

function pool(index: number, side: SessionPool["side"]): SessionPool {
  return {
    id: `0x${String(index).padStart(40, "0")}`,
    market: `0x${"c".repeat(40)}`,
    side,
    outcomeToken: `0x${String(index).padStart(40, "a")}`,
    underlyingToken: `0x${"b".repeat(40)}`,
    underlyingPerOutcome: null,
    volumeUnderlying: 0n,
    volumeOutcome: 0n,
  };
}

const UP = pool(1, "UP");
const DOWN = pool(2, "DOWN");

/** `pool` holds `outcome` of its outcome token and `underlying` of its underlying, in whole tokens. */
function hold(each: SessionPool, outcome: string, underlying: string) {
  chain.balances.set(`${each.outcomeToken}|${each.id}`, parseEther(outcome));
  chain.balances.set(`${each.underlyingToken}|${each.id}`, parseEther(underlying));
}

function renderBalances(pools: SessionPool[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const rendered = renderHook(({ list }) => usePoolBalances(SESSION_ID, list), {
    wrapper,
    initialProps: { list: pools },
  });
  return { ...rendered, client };
}

beforeEach(() => {
  chain.balances.clear();
  chain.down = false;
  hold(UP, "40", "12.5");
  hold(DOWN, "20", "6");
});

describe("usePoolBalances", () => {
  it("reads a pool that joins the list while the balances it holds are still fresh", async () => {
    const { result, rerender } = renderBalances([UP]);
    await waitFor(() => expect(result.current.data).toBeDefined());

    rerender({ list: [UP, DOWN] });

    await waitFor(() =>
      expect(result.current.data).toEqual({
        [UP.id]: { outcome: parseEther("40"), underlying: parseEther("12.5") },
        [DOWN.id]: { outcome: parseEther("20"), underlying: parseEther("6") },
      }),
    );
  });

  it("serves none of a previous list's balances while a changed list is read", async () => {
    const { result, rerender } = renderBalances([UP]);
    await waitFor(() => expect(result.current.data).toBeDefined());

    rerender({ list: [UP, DOWN] });

    expect(result.current.data).toBeUndefined();
  });

  it("reads the balances again once the session's stats are reread after a failed read", async () => {
    chain.down = true;
    const { result, client } = renderBalances([UP]);
    await waitFor(() => expect(result.current.isError).toBe(true));
    chain.down = false;

    await act(() => client.invalidateQueries({ queryKey: sessionStatsKey(SESSION_ID) }));

    await waitFor(() =>
      expect(result.current.data).toEqual({ [UP.id]: { outcome: parseEther("40"), underlying: parseEther("12.5") } }),
    );
  });
});

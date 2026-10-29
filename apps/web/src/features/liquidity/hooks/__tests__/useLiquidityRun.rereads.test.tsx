import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { liquidityKeyPrefix } from "../../api/getLiquidityPools";
import { owner } from "../../flow/__tests__/support/session";
import type { LiquidityProgress } from "../../types";
import { useLiquidityRun } from "../useLiquidityRun";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/config/chains", async (importOriginal) => {
  const { gnosis } = await import("viem/chains");
  return {
    ...(await importOriginal<typeof import("@/config/chains")>()),
    DEFAULT_CHAIN_ID: gnosis.id,
    DEFAULT_CHAIN: gnosis,
  };
});
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: owner, chainId: 100, isConnected: true, status: "connected" }),
}));

/** The driver the hook builds, whose stage the test moves. */
const driver = vi.hoisted(() => {
  const idle = { stage: "idle", rows: [], signatures: { done: 0, total: 0 } } as unknown as LiquidityProgress;
  let progress = idle;
  const listeners = new Set<() => void>();
  return {
    reset() {
      progress = idle;
      listeners.clear();
    },
    moveTo(stage: LiquidityProgress["stage"]) {
      progress = { ...progress, stage };
      for (const listener of listeners) listener();
    },
    port: {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getProgress: () => progress,
      recover: () => {},
      dispose: () => {},
    },
  };
});
vi.mock("../../run/driver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../run/driver")>()),
  createLiquidityRun: () => driver.port,
}));

const PARENT = "0x0845542D4D7fcF46B86Ca5aB777479139eFf5466";

beforeEach(() => driver.reset());

function renderRun() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useLiquidityRun(PARENT, null), { wrapper });
  const rereads = () => invalidate.mock.calls.filter(([filters]) => filters?.queryKey === liquidityKeyPrefix).length;
  return { result, rereads };
}

describe("useLiquidityRun rereads the session's pools and positions", () => {
  it.each(["complete", "moved", "halted"] as const)("once a run stops as %s", async (stage) => {
    const { result, rereads } = renderRun();
    await waitFor(() => expect(result.current.progress?.stage).toBe("idle"));
    act(() => driver.moveTo("signing"));

    act(() => driver.moveTo(stage));

    expect(rereads()).toBe(1);
  });

  it("once per arrival at halted, not on each progress update after it", async () => {
    const { result, rereads } = renderRun();
    await waitFor(() => expect(result.current.progress?.stage).toBe("idle"));
    act(() => driver.moveTo("halted"));

    act(() => driver.moveTo("halted"));
    act(() => driver.moveTo("halted"));

    expect(rereads()).toBe(1);
  });

  it("again when a retried run halts a second time", async () => {
    const { result, rereads } = renderRun();
    await waitFor(() => expect(result.current.progress?.stage).toBe("idle"));
    act(() => driver.moveTo("halted"));
    act(() => driver.moveTo("signing"));

    act(() => driver.moveTo("halted"));

    expect(rereads()).toBe(2);
  });

  it.each(["signing", "confirming", "review"] as const)("not while a run is %s", async (stage) => {
    const { result, rereads } = renderRun();
    await waitFor(() => expect(result.current.progress?.stage).toBe("idle"));

    act(() => driver.moveTo(stage));

    expect(rereads()).toBe(0);
  });
});

import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deferred, sharedLocks } from "@/features/resolution/redeem/__tests__/support/locks";
import { OWNER } from "@/features/resolution/redeem/__tests__/support/session";
import { createRedeemRun } from "@/features/resolution/redeem/run";

import { useWalletRedeemRun } from "../useWalletRedeem";

vi.mock("wagmi", () => ({ useAccount: () => ({ address: OWNER, chainId: 100 }) }));
vi.mock("@/config/chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/chains")>()),
  DEFAULT_CHAIN_ID: 100,
}));
vi.mock("@wagmi/core", () => ({ sendTransaction: vi.fn(), getConnectorClient: vi.fn() }));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/features/resolution/redeem/run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/resolution/redeem/run")>()),
  createRedeemRun: vi.fn(() => ({
    recover: vi.fn(),
    dispose: vi.fn(),
    subscribe: () => () => {},
    getProgress: () => null,
  })),
}));

const SESSION = { sessionFactory: "0x5f00000000000000000000000000000000000000" as const, sessionId: 7n };
const client = new QueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.mocked(createRedeemRun).mockClear();
  Object.defineProperty(navigator, "locks", { configurable: true, value: sharedLocks().locks });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "locks");
  client.clear();
});

describe("useWalletRedeemRun browser ownership", () => {
  it("gives drivers for the same session and wallet mutually exclusive browser locks", async () => {
    renderHook(() => useWalletRedeemRun(SESSION), { wrapper });
    renderHook(() => useWalletRedeemRun(SESSION), { wrapper });
    const first = vi.mocked(createRedeemRun).mock.calls[0]![0];
    const second = vi.mocked(createRedeemRun).mock.calls[1]![0];
    expect(first.withLock).toBeTypeOf("function");
    expect(second.withLock).toBeTypeOf("function");
    const open = deferred();
    const signal = new AbortController().signal;
    const running = first.withLock!(() => open.promise, signal);
    const work = vi.fn(async () => {});

    await expect(second.withLock!(work, signal)).rejects.toMatchObject({ reason: "elsewhere" });

    expect(work).not.toHaveBeenCalled();
    open.resolve();
    await running;
  });
});

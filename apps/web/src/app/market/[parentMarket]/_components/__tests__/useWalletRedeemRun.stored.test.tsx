import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OWNER, plannerInput } from "@/features/resolution/redeem/__tests__/support/session";
import { planWalletRedeem } from "@/features/resolution/redeem/plan";
import { redeemRunStore } from "@/features/resolution/redeem/store";

import { useWalletRedeemRun, walletRedeemFlowId } from "../useWalletRedeem";

vi.mock("wagmi", () => ({ useAccount: () => ({ address: OWNER, chainId: 100 }) }));
vi.mock("@/config/chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/chains")>()),
  DEFAULT_CHAIN_ID: 100,
}));
vi.mock("@wagmi/core", () => ({ sendTransaction: vi.fn(), getConnectorClient: vi.fn() }));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

const FACTORY = "0x5f00000000000000000000000000000000000000" as Address;
const STORED = { sessionFactory: FACTORY, sessionId: 7n };

/** A run this browser kept for session 7: rejected at its first prompt, nothing sent. */
function storeRun() {
  const request = plannerInput({ owner: OWNER });
  redeemRunStore().save({
    flowId: walletRedeemFlowId(STORED, OWNER),
    adapterId: "redeem-flow",
    snapshot: { request, atomic: false, sends: {} },
    ctx: { owner: OWNER, chainId: 100 },
    steps: planWalletRedeem(request).calls.map((_, index) => ({
      stepId: `call:${index}`,
      label: `call:${index}`,
      outcome: { status: "pending" as const },
    })),
    status: "paused",
    reason: "rejected",
  });
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

beforeEach(() => {
  window.localStorage.clear();
  storeRun();
});

describe("useWalletRedeemRun over this browser's stored runs", () => {
  it("shows the session's stored run for review on mount, signing nothing", async () => {
    const { result } = renderHook(() => useWalletRedeemRun(STORED), { wrapper });

    await waitFor(() => expect(result.current.progress?.stage).toBe("review"));
  });

  it("leaves another session's stored run alone, even of the same factory", async () => {
    const { result } = renderHook(() => useWalletRedeemRun({ sessionFactory: FACTORY, sessionId: 8n }), { wrapper });

    await waitFor(() => expect(result.current.progress).not.toBeNull());
    expect(result.current.progress?.stage).toBe("idle");
  });
});

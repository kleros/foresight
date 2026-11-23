import type { ReactNode } from "react";

import {
  createFlowRunStore,
  createMemoryStorage,
  DEFAULT_RUN_TTL_MS,
  type FlowRunStore,
  type PersistedFlowRunInput,
} from "@foresight/tx-orchestrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Address } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { liquidityKeyPrefix } from "@/features/liquidity/api/getLiquidityPools";
import type { RedeemProgress, RedeemSnapshot } from "@/features/resolution/redeem/run";

import { useWalletRedeemRun, walletRedeemKeyPrefix } from "../useWalletRedeem";

const OWNER: Address = "0x00000000000000000000000000000000000000a1";
const SESSION = { sessionFactory: "0x5f00000000000000000000000000000000000000" as Address, sessionId: 7n };
const T0 = 1_700_000_000_000;

const captured = vi.hoisted(() => ({
  store: undefined as FlowRunStore | undefined,
  now: 0,
  progress: { stage: "idle" } as RedeemProgress,
  listeners: new Set<() => void>(),
}));

vi.mock("wagmi", () => ({ useAccount: () => ({ address: OWNER, chainId: 100 }) }));
vi.mock("@wagmi/core", () => ({ getConnectorClient: vi.fn(), sendTransaction: vi.fn() }));
vi.mock("@/lib/web3/wagmi", () => ({ wagmiConfig: {} }));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/config/chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/chains")>()),
  DEFAULT_CHAIN_ID: 100,
}));
// the hook's store over memory storage and a clock the test moves
vi.mock("@/lib/flowRunStore", () => ({
  createRunStore: (unsettled?: Parameters<typeof createFlowRunStore>[0]["unsettled"]) =>
    createFlowRunStore({
      storage: createMemoryStorage(),
      now: () => captured.now,
      ...(unsettled ? { unsettled } : {}),
    }),
}));
vi.mock("@/features/resolution/redeem/run", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/resolution/redeem/run")>();
  return {
    ...actual,
    createRedeemRun: (args: Parameters<typeof actual.createRedeemRun>[0]) => {
      captured.store = args.store;
      return {
        start() {},
        recover() {},
        resume() {},
        retry() {},
        discard: () => Promise.resolve(),
        dispose() {},
        getProgress: () => captured.progress,
        subscribe: (listener: () => void) => {
          captured.listeners.add(listener);
          return () => void captured.listeners.delete(listener);
        },
      };
    },
  };
});

afterEach(() => {
  captured.store = undefined;
  captured.progress = { stage: "idle" };
  captured.listeners.clear();
});

function storedRun(sends: RedeemSnapshot["sends"]): PersistedFlowRunInput<Partial<RedeemSnapshot>, unknown> {
  return {
    flowId: "redeem-store",
    adapterId: "redeem-flow",
    snapshot: { atomic: false, sends },
    ctx: { owner: OWNER, chainId: 100 },
    steps: [
      {
        stepId: "call:0",
        label: "call:0",
        outcome: { status: "confirmed", hash: `0x${"1".repeat(64)}`, blockNumber: 1n },
      },
      { stepId: "call:1", label: "call:1", outcome: { status: "pending" } },
    ],
    status: "paused",
    reason: "error",
  };
}

async function hookStore(client = new QueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  renderHook(() => useWalletRedeemRun(OWNER, SESSION), { wrapper });
  await waitFor(() => expect(captured.store).toBeDefined());
  return captured.store!;
}

const SEND = { tx: { to: OWNER, data: "0x" as const }, nonce: 1, fromBlock: 1n };

describe("useWalletRedeemRun's store (R7)", () => {
  it("keeps a run past its expiry while a send for an unsettled step is stored", async () => {
    const store = await hookStore();
    captured.now = T0;
    store.save(storedRun({ "call:1": SEND }));

    captured.now = T0 + DEFAULT_RUN_TTL_MS + 1;

    expect(store.load("redeem-store")).not.toBeNull();
  });

  it("lets a run expire when its only stored send is for a confirmed step", async () => {
    const store = await hookStore();
    captured.now = T0;
    store.save(storedRun({ "call:0": SEND }));

    captured.now = T0 + DEFAULT_RUN_TTL_MS + 1;

    expect(store.load("redeem-store")).toBeNull();
  });
});

describe("useWalletRedeemRun rereads balances after a run", () => {
  it.each(["complete", "halted"] as const)(
    "rereads the wallet's redeem list and pools once a run is %s",
    async (stage) => {
      const client = new QueryClient();
      const invalidate = vi.spyOn(client, "invalidateQueries");
      await hookStore(client);
      expect(invalidate).not.toHaveBeenCalled();

      act(() => {
        captured.progress = { stage };
        for (const listener of captured.listeners) listener();
      });

      await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: walletRedeemKeyPrefix }));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: liquidityKeyPrefix });
    },
  );
});

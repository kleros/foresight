import { act, renderHook } from "@testing-library/react";
import { sendTransaction } from "@wagmi/core";
import type { Address, Hash } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRunStore } from "@/lib/flowRunStore";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { addresses, ctx, option, WAD } from "../../flow/__tests__/support/fakes";
import { STEP_ID } from "../../flow/plan";
import type { PredictCtx, PredictSnapshot } from "../../flow/types";
import { usePredictRun, type PredictRunInput } from "../usePredictRun";

vi.mock("@wagmi/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@wagmi/core")>()),
  sendTransaction: vi.fn(),
}));

vi.mock("@/lib/web3/wagmi", () => ({ wagmiConfig: {} }));

vi.mock("@/lib/web3/public-client", () => {
  const receipt = ({ hash }: { hash: `0x${string}` }) =>
    Promise.resolve({ transactionHash: hash, status: "success", blockNumber: 19_000_000n });
  return {
    publicClient: {
      waitForTransactionReceipt: vi.fn(receipt),
      getTransactionReceipt: vi.fn(receipt),
      getTransaction: vi.fn(({ hash }: { hash: `0x${string}` }) => Promise.resolve({ hash })),
    },
  };
});

vi.mock("../../run/reader", async () => {
  const { fakeReader, WAD: wad } = await import("../../flow/__tests__/support/fakes");
  return { createPredictReader: () => fakeReader({ deployed: true, collateral: wad }) };
});

vi.mock("@/lib/swap/lens", async () => {
  const { fakeQuoter } = await import("../../flow/__tests__/support/fakes");
  return { createLensQuoter: () => fakeQuoter() };
});

const sendMock = vi.mocked(sendTransaction);

const SESSION_ID = "42";
const LEGACY_FLOW_ID = `predict-${SESSION_ID}`;
const OWNER_B = "0x00000000000000000000000000000000000000b1" as Address;
const EXECUTOR_B = "0x00000000000000000000000000000000000000b2" as Address;
const DEPOSIT_HASH = `0x${"d".repeat(64)}` as Hash;

const input = (owner: Address, executor: Address): PredictRunInput => ({
  sessionId: SESSION_ID,
  parentMarket: addresses.parentMarket,
  collateral: addresses.collateral,
  router: addresses.router,
  factory: addresses.factory,
  owner,
  executor,
  sDaiAdapter: addresses.sDaiAdapter,
  options: () => [option(1)],
  deposit: () => WAD,
  depositNative: () => false,
  collateralIn: () => WAD,
  collateralBefore: () => 0n,
});

function saveLegacyRunOfA(chainId: number) {
  createRunStore().save<PredictSnapshot, PredictCtx>({
    flowId: LEGACY_FLOW_ID,
    adapterId: "predict-flow",
    status: "paused",
    reason: "rejected",
    ctx: ctx({ chainId }),
    snapshot: {
      options: [option(1)],
      deposit: WAD,
      depositNative: false,
      collateralIn: WAD,
      collateralBefore: 0n,
      startedAt: 1_700_000_000,
    },
    steps: [
      { stepId: STEP_ID.createExecutor, label: "Set up your trade wallet", outcome: { status: "skipped" } },
      {
        stepId: STEP_ID.deposit,
        label: "Add money to your trade wallet",
        outcome: { status: "submitted", hash: DEPOSIT_HASH },
      },
      { stepId: STEP_ID.predict(1), label: "Making your prediction", outcome: { status: "pending" } },
    ],
  });
}

async function runToEnd(owner: Address, executor: Address) {
  const hook = renderHook(() => usePredictRun(input(owner, executor)));
  act(() => hook.result.current.driver!.start());
  await vi.waitFor(() => {
    const progress = hook.result.current.progress;
    expect(progress?.stage === "complete" || progress?.failure !== undefined).toBe(true);
  });
  const stage = hook.result.current.progress?.stage;
  hook.unmount();
  return stage;
}

let nonce = 0;
beforeEach(() => {
  window.localStorage.clear();
  nonce = 0;
  sendMock.mockReset();
  sendMock.mockImplementation(() => Promise.resolve(`0x${(++nonce).toString(16).padStart(64, "0")}` as Hash));
});

afterEach(() => {
  window.localStorage.clear();
});

describe("usePredictRun with a run A left under the session-only key", () => {
  it("still recovers it for A after B has predicted on the same session", async () => {
    saveLegacyRunOfA(DEFAULT_CHAIN_ID);
    const { publicClient } = await import("@/lib/web3/public-client");

    expect(await runToEnd(OWNER_B, EXECUTOR_B)).toBe("complete");
    vi.mocked(publicClient.getTransactionReceipt).mockClear();
    sendMock.mockClear();

    expect(await runToEnd(addresses.owner, addresses.executor)).toBe("complete");
    expect(vi.mocked(publicClient.getTransactionReceipt)).toHaveBeenCalledWith(
      expect.objectContaining({ hash: DEPOSIT_HASH }),
    );
    expect(sendMock.mock.calls.filter((call) => call[1].to === addresses.collateral)).toEqual([]);
    expect(createRunStore().load(LEGACY_FLOW_ID)).toBeNull();
  });

  it("lets B predict on the session once A's run has moved to A's own key", async () => {
    saveLegacyRunOfA(DEFAULT_CHAIN_ID);
    renderHook(() => usePredictRun(input(addresses.owner, addresses.executor))).unmount();

    expect(await runToEnd(OWNER_B, EXECUTOR_B)).toBe("complete");
    const kept = createRunStore()
      .list<PredictSnapshot, PredictCtx>()
      .filter((run) => run.ctx.owner === addresses.owner);
    expect(kept).toHaveLength(1);
  });

  it("leaves a run A saved on another chain where it is, and starts A's own run", async () => {
    saveLegacyRunOfA(10200);

    expect(await runToEnd(addresses.owner, addresses.executor)).toBe("complete");
    expect(createRunStore().load<PredictSnapshot, PredictCtx>(LEGACY_FLOW_ID)?.ctx.chainId).toBe(10200);
  });
});

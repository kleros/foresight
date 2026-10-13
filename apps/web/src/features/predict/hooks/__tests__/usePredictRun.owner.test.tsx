import type { StepSummary } from "@foresight/tx-orchestrator";
import { act, renderHook } from "@testing-library/react";
import { sendTransaction } from "@wagmi/core";
import { decodeFunctionData, erc20Abi, type Address, type Hash } from "viem";
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

/* The real config builds AppKit connectors from env this suite does not supply. */
vi.mock("@/lib/web3/wagmi", () => ({ wagmiConfig: {} }));

/* Every hash is mined. */
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
const OWNER_A = addresses.owner;
const EXECUTOR_A = addresses.executor;
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

const savedSnapshot: PredictSnapshot = {
  options: [option(1)],
  deposit: WAD,
  depositNative: false,
  collateralIn: WAD,
  collateralBefore: 0n,
  startedAt: 1_700_000_000,
};

const ctxOfA = (): PredictCtx => ctx({ chainId: DEFAULT_CHAIN_ID });

function steps(deposit: StepSummary["outcome"]): StepSummary[] {
  return [
    { stepId: STEP_ID.createExecutor, label: "Set up your trade wallet", outcome: { status: "skipped" } },
    { stepId: STEP_ID.deposit, label: "Add money to your trade wallet", outcome: deposit },
    { stepId: STEP_ID.predict(1), label: "Making your prediction", outcome: { status: "pending" } },
  ];
}

/** A run A left behind under the session-only key the hook wrote before runs were scoped. */
function saveLegacyRunOfA(deposit: StepSummary["outcome"]) {
  createRunStore().save<PredictSnapshot, PredictCtx>({
    flowId: LEGACY_FLOW_ID,
    adapterId: "predict-flow",
    status: "paused",
    reason: "rejected",
    ctx: ctxOfA(),
    snapshot: savedSnapshot,
    steps: steps(deposit),
  });
}

const savedRunsOfA = () =>
  createRunStore()
    .list<PredictSnapshot, PredictCtx>()
    .filter((run) => run.ctx.owner === OWNER_A);

type SendArgs = Parameters<typeof sendTransaction>[1] & { account?: unknown; chainId?: number };
const sent = (): SendArgs[] => sendMock.mock.calls.map((call) => call[1] as SendArgs);

/** Whether a prompt moves money into, or acts through, A's trade wallet. */
function reachesExecutorA(tx: SendArgs): boolean {
  if (tx.to === EXECUTOR_A) return true;
  if (tx.to !== addresses.collateral || !tx.data) return false;
  const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data });
  return decoded.args?.[0] === EXECUTOR_A;
}

async function settle(result: { current: ReturnType<typeof usePredictRun> }) {
  await vi.waitFor(() => {
    const progress = result.current.progress;
    // a recovered run waits at review until the owner resumes it, as the popup's Resume does
    if (progress?.stage === "review") result.current.driver?.resume();
    expect(progress?.stage === "complete" || progress?.failure !== undefined).toBe(true);
  });
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
  it.each([
    ["a deposit not yet signed", { status: "pending" } as const],
    ["a deposit submitted and mined", { status: "submitted", hash: DEPOSIT_HASH } as const],
  ])("never prompts B for A's run, with %s, and keeps A's run", async (_, deposit) => {
    saveLegacyRunOfA(deposit);

    const { result } = renderHook(() => usePredictRun(input(OWNER_B, EXECUTOR_B)));
    act(() => result.current.driver!.start());
    await settle(result);

    expect(sent().filter(reachesExecutorA)).toEqual([]);
    for (const tx of sent()) expect(tx.account).toBe(OWNER_B);

    const kept = savedRunsOfA();
    expect(kept).toHaveLength(1);
    expect(kept[0]!.steps.find((step) => step.stepId === STEP_ID.deposit)?.outcome).toEqual(deposit);
  });

  it("recovers it for A: reconciles the submitted deposit and signs the rest as A on the app's chain", async () => {
    saveLegacyRunOfA({ status: "submitted", hash: DEPOSIT_HASH });
    const { publicClient } = await import("@/lib/web3/public-client");

    const { result } = renderHook(() => usePredictRun(input(OWNER_A, EXECUTOR_A)));
    act(() => result.current.driver!.start());
    await settle(result);

    expect(result.current.progress?.stage).toBe("complete");
    expect(vi.mocked(publicClient.getTransactionReceipt)).toHaveBeenCalledWith(
      expect.objectContaining({ hash: DEPOSIT_HASH }),
    );
    expect(sent().filter((tx) => tx.to === addresses.collateral)).toEqual([]);
    expect(sent().length).toBeGreaterThan(0);
    for (const tx of sent()) {
      expect(tx.account).toBe(OWNER_A);
      expect(tx.chainId).toBe(DEFAULT_CHAIN_ID);
    }
  });
});

describe("usePredictRun when the wallet changes between steps", () => {
  it("binds every prompt to the run's owner and chain, even after the wallet leaves the chain mid-run", async () => {
    let releaseFirst!: () => void;
    sendMock.mockImplementationOnce(
      () =>
        new Promise<Hash>((resolve) => {
          releaseFirst = () => resolve(`0x${(++nonce).toString(16).padStart(64, "0")}` as Hash);
        }),
    );

    const { result, rerender } = renderHook((props: PredictRunInput | null) => usePredictRun(props), {
      initialProps: input(OWNER_A, EXECUTOR_A) as PredictRunInput | null,
    });
    act(() => result.current.driver!.start());
    await vi.waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));

    // The caller's input goes null when the connected wallet is no longer usable here.
    rerender(null);
    await act(async () => releaseFirst());
    await settle(result);

    expect(sent().length).toBeGreaterThan(1);
    for (const tx of sent()) {
      expect(tx.account).toBe(OWNER_A);
      expect(tx.chainId).toBe(DEFAULT_CHAIN_ID);
    }
  });
});

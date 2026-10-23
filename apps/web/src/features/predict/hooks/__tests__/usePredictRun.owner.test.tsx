import { act, renderHook } from "@testing-library/react";
import { sendTransaction } from "@wagmi/core";
import type { Address, Hash } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { createRunStore } from "@/lib/flowRunStore";

import { addresses, ctx, option, snapshot, WAD } from "../../flow/__tests__/support/fakes";
import { STEP_ID } from "../../flow/plan";
import type { PredictCtx, PredictSnapshot } from "../../flow/types";
import { predictFlowId } from "../../run/interrupted";
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
  const { fakeCreditsQuoter, fakeQuoter } = await import("../../flow/__tests__/support/fakes");
  return { createLensQuoter: () => fakeQuoter(), createLensExactInputQuoter: () => fakeCreditsQuoter() };
});

const sendMock = vi.mocked(sendTransaction);

const SESSION_ID = "42";
const OWNER_A = addresses.owner;
const EXECUTOR_A = addresses.executor;

const input = (owner: Address, executor: Address): PredictRunInput => ({
  sessionId: SESSION_ID,
  closesAt: null,
  parentMarket: addresses.parentMarket,
  collateral: addresses.collateral,
  router: addresses.router,
  factory: addresses.factory,
  owner,
  executor,
  sDaiAdapter: addresses.sDaiAdapter,
  credits: null,
  options: () => [option(1)],
  sessionOptions: () => [option(1), option(2)],
  funding: () => ({
    deposit: WAD,
    depositNative: false,
    collateralIn: WAD,
    collateralBefore: 0n,
    creditsFromEoa: 0n,
    creditsToSpend: 0n,
  }),
  slippage: () => ({ tradeBps: 100, creditsBps: 20 }),
});

type SendArgs = Parameters<typeof sendTransaction>[1] & { account?: unknown; chainId?: number };
const sent = (): SendArgs[] => sendMock.mock.calls.map((call) => call[1] as SendArgs);

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

describe("usePredictRun recovering a stored run", () => {
  it("halts with nothing signed when a stored option names another token than the session's", async () => {
    createRunStore().save<PredictSnapshot, PredictCtx>({
      flowId: predictFlowId(SESSION_ID, OWNER_A),
      adapterId: "predict-flow",
      status: "paused",
      reason: "rejected",
      // the app's own contracts, so only the option differs
      ctx: ctx({ chainId: DEFAULT_CHAIN_ID, credits: null }),
      snapshot: snapshot({
        options: [{ ...option(1), downToken: "0x00000000000000000000000000000000000000ad" }],
        deposit: WAD,
        collateralIn: WAD,
        collateralBefore: 0n,
      }),
      steps: [
        { stepId: STEP_ID.createExecutor, label: "Set up your trade wallet", outcome: { status: "skipped" } },
        { stepId: STEP_ID.deposit, label: "Add money to your trade wallet", outcome: { status: "pending" } },
        { stepId: STEP_ID.predict(1), label: "Making your prediction", outcome: { status: "pending" } },
      ],
    });
    const { result } = renderHook(() => usePredictRun(input(OWNER_A, EXECUTOR_A)));

    act(() => result.current.driver!.start());

    await vi.waitFor(() => expect(result.current.progress?.failure?.reason).toBe("unknown"));
    expect(sendMock).not.toHaveBeenCalled();
  });
});

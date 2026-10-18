import { createFlowRunStore, createMemoryStorage, type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import { decodeFunctionData, erc20Abi, type Hash, type Hex, type TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { gnosisRouterAbi, tradeExecutorAbi } from "@/config/contracts";

import { addresses, ctx, fakeQuoter, fakeReader, snapshot, WAD } from "../../flow/__tests__/support/fakes";
import { STEP_ID } from "../../flow/plan";
import type { PredictReader, PredictSnapshot } from "../../flow/types";
import { predictSteps } from "../../utils/predictSteps";
import { createPredictRun } from "../driver";
import type { PredictDriver, PredictProgress } from "../types";

/**
 * A trade wallet whose collateral only the chain knows. A deposit adds to it when it mines; a
 * deposit that is `stuck` was signed but never mines, so the balance does not move.
 */
function chain(opts: { balance: bigint; stuck?: boolean }) {
  let balance = opts.balance;
  const signRequests: FlowTx[] = [];
  /** The balance the wallet held when each request was signed. */
  const balanceAtSign: bigint[] = [];

  const receipt = (hash: Hash): TransactionReceipt =>
    ({ transactionHash: hash, status: "success", blockNumber: 19_000_000n }) as TransactionReceipt;

  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      signRequests.push(tx);
      balanceAtSign.push(balance);
      if (!opts.stuck && tx.to === addresses.collateral && tx.data) {
        const { args } = decodeFunctionData({ abi: erc20Abi, data: tx.data });
        if (args[0] === addresses.executor) balance += args[1] as bigint;
      }
      if (!opts.stuck && tx.to === addresses.sDaiAdapter) balance += tx.value ?? 0n;
      return Promise.resolve(`0x${signRequests.length.toString(16).padStart(64, "0")}` as Hash);
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
    getReceipt: () => Promise.resolve(null),
    isKnown: () => Promise.resolve(true),
  };

  const base = fakeReader({ deployed: true });
  const reader: PredictReader = { ...base, collateralBalance: () => Promise.resolve(balance) };

  return { gateway, reader, signRequests, balanceAtSign };
}

const isDeposit = (tx: FlowTx) => tx.to === addresses.collateral || tx.to === addresses.sDaiAdapter;
const isBatch = (tx: FlowTx) => tx.to === addresses.executor;

/** The collateral a predict transaction splits at the session's parent. */
function parentSplit(data: Hex): bigint {
  const decoded = decodeFunctionData({ abi: tradeExecutorAbi, data });
  if (decoded.functionName !== "batchExecute") throw new Error(`Expected batchExecute, got ${decoded.functionName}`);

  for (const call of decoded.args[0]) {
    if (call.to !== addresses.router) continue;
    const inner = decodeFunctionData({ abi: gnosisRouterAbi, data: call.data });
    if (inner.functionName === "splitPosition" && inner.args[1] === addresses.parentMarket) return inner.args[2];
  }
  return 0n;
}

const message = (progress: PredictProgress) =>
  predictSteps({ wallet: null, toAdd: 0n, symbol: "sDAI", decimals: 18, progress }).failure;

const PRICES_MESSAGE = message({
  stage: "halted",
  steps: [],
  skipped: [],
  batchesDone: 0,
  batches: 1,
  failure: { reason: "reverted", retryable: false },
});

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

describe("a cached trade-wallet balance above the real one", () => {
  it.each([
    ["2 sDAI above", WAD * 4n, WAD * 6n],
    ["1 wei above", WAD * 6n - 1n, WAD * 6n],
    ["all of it, the wallet being empty", 0n, WAD * 6n],
  ])("never signs a split for more than the trade wallet holds (cache %s)", async (_, real, cached) => {
    const collateralIn = WAD * 10n;
    const snap: PredictSnapshot = snapshot({
      deposit: collateralIn - cached,
      collateralIn,
      collateralBefore: cached,
    });
    const world = chain({ balance: real });
    const driver = createPredictRun({
      gateway: world.gateway,
      reader: world.reader,
      quoter: fakeQuoter(),
      flowId: `predict-stale-sdai-${drivers.length}`,
      ctx: () => ctx(),
      snapshot: () => snap,
    });
    drivers.push(driver);

    driver.start();
    await vi.waitFor(() => expect(["halted", "complete"]).toContain(driver.getProgress().stage));

    const overdrawn = world.signRequests.flatMap((tx, index) =>
      isBatch(tx) && parentSplit(tx.data!) > world.balanceAtSign[index]!
        ? [`split ${parentSplit(tx.data!)} with ${world.balanceAtSign[index]} in the wallet`]
        : [],
    );
    expect(overdrawn).toEqual([]);

    const progress = driver.getProgress();
    const halt = progress.stage === "halted" ? message(progress) : undefined;
    expect(halt === undefined || (halt !== PRICES_MESSAGE && /balance/i.test(halt)), `halted with: ${halt}`).toBe(true);
  });
});

describe("an sDAI request that splits more than it deposits and the trade wallet holds", () => {
  it("refuses before signing anything", async () => {
    // 1 sDAI deposited, none in the trade wallet, 1.0001 asked for
    const snap = snapshot({ deposit: WAD, collateralIn: WAD + 10n ** 14n, collateralBefore: 0n });
    const world = chain({ balance: 0n });
    const driver = createPredictRun({
      gateway: world.gateway,
      reader: world.reader,
      quoter: fakeQuoter(),
      flowId: "predict-split-over-deposit",
      ctx: () => ctx(),
      snapshot: () => snap,
    });
    drivers.push(driver);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));

    expect(driver.getProgress().failure?.reason).toBe("balance");
    expect(world.signRequests).toEqual([]);
  });
});

describe("recovering a run whose deposit was signed but has not mined", () => {
  it.each([
    ["an sDAI deposit", false],
    ["an xDAI deposit", true],
  ])("does not ask for a second deposit signature (%s)", async (_, depositNative) => {
    const before = WAD * 2n;
    const snap: PredictSnapshot = snapshot({
      deposit: WAD * 3n,
      depositNative,
      collateralIn: WAD * 5n,
      collateralBefore: before,
    });
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const flowId = `predict-pending-deposit-${depositNative ? "xdai" : "sdai"}`;

    // the tab died between the wallet signing the deposit and its hash reaching storage
    store.save<PredictSnapshot, ReturnType<typeof ctx>>({
      flowId,
      adapterId: "predict-flow",
      snapshot: snap,
      ctx: ctx(),
      status: "running",
      steps: [
        {
          stepId: STEP_ID.createExecutor,
          label: "Set up your trade wallet",
          outcome: { status: "confirmed", hash: `0x${"a".repeat(64)}`, blockNumber: 18_999_999n },
        },
        { stepId: STEP_ID.deposit, label: "Add money to your trade wallet", outcome: { status: "awaiting-signature" } },
        { stepId: STEP_ID.predict(1), label: "Making your prediction", outcome: { status: "pending" } },
      ],
    });

    const world = chain({ balance: before, stuck: true });
    const driver = createPredictRun({
      gateway: world.gateway,
      reader: world.reader,
      quoter: fakeQuoter(),
      flowId,
      store,
      ctx: () => ctx(),
      snapshot: () => snap,
    });
    drivers.push(driver);

    driver.start();
    // a run may halt with a reason, or wait on the pending deposit; neither may open the wallet for it
    const settled = () => {
      const progress = driver.getProgress();
      return progress.stage === "complete" || (progress.stage === "halted" && progress.failure !== undefined);
    };
    await vi
      .waitFor(() => expect(world.signRequests.some(isDeposit) || settled()).toBe(true), { timeout: 1_000 })
      .catch(() => undefined);

    expect(world.signRequests.filter(isDeposit)).toEqual([]);
  });
});

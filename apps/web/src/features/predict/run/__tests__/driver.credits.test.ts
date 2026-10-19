import {
  createFlowRunStore,
  createMemoryStorage,
  type FlowRunStore,
  type FlowTx,
  type StepSummary,
  type TxGateway,
} from "@foresight/tx-orchestrator";
import { decodeFunctionData, parseAbi, type Hash, type TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { tradeExecutorAbi } from "@/config/contracts";

import {
  addresses,
  chainState,
  ctx,
  fakeCreditsQuoter,
  fakeQuoter,
  fakeReader,
  gasLimitFor,
  landedTx,
  option,
  snapshot,
  WAD,
} from "../../flow/__tests__/support/fakes";
import { planPredict, STEP_ID } from "../../flow/plan";
import type { LandedTx, OptionChainState, PredictCtx, PredictOption, PredictSnapshot } from "../../flow/types";
import { predictSteps } from "../../utils/predictSteps";
import { createPredictRun } from "../driver";
import type { PredictDriver } from "../types";

const TRANSFER = parseAbi(["function transfer(address to, uint256 amount)"]);
const EXECUTE = parseAbi(["function execute(address to, bytes data, uint256 amount, address outputToken)"]);

/**
 * A chain that keeps the credits: a transfer moves them from the owner to the trade wallet, a
 * landed first batch burns what its `execute` names. `revert` lists the sends that revert.
 */
function creditsChain(
  start: {
    owner: bigint;
    executor: bigint;
    manager?: bigint;
    state?: (option: PredictOption) => OptionChainState;
    /** What landed before the test starts, as the reader finds it. */
    landed?: FlowTx[];
  },
  revert: number[] = [],
) {
  const balances = { owner: start.owner, executor: start.executor };
  const ledger: LandedTx[] = (start.landed ?? []).map((tx) => landedTx(tx));
  const signRequests: FlowTx[] = [];
  const landed = { transfers: 0, spends: 0 };
  const chain = new Map<Hash, "success" | "reverted">();
  const receipt = (hash: Hash, status: "success" | "reverted") =>
    ({ transactionHash: hash, status, blockNumber: 19_000_000n }) as TransactionReceipt;

  /** The credits `tx` burns, as the manager checks them against the caller's balance. */
  function burns(tx: FlowTx): bigint {
    if (tx.to !== addresses.executor) return 0n;
    const decoded = decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data! });
    if (decoded.functionName !== "batchValueExecute") return 0n;
    return decoded.args[0]
      .filter((call) => call.to === addresses.manager)
      .reduce((sum, call) => sum + decodeFunctionData({ abi: EXECUTE, data: call.data }).args[2], 0n);
  }

  /** What `tx` does to the credits, applied when it lands. */
  function apply(tx: FlowTx) {
    ledger.push(landedTx(tx));
    if (tx.to === addresses.credits) {
      const [, amount] = decodeFunctionData({ abi: TRANSFER, data: tx.data! }).args;
      balances.owner -= amount;
      balances.executor += amount;
      landed.transfers += 1;
      return;
    }
    if (tx.to !== addresses.executor) return;
    const decoded = decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data! });
    if (decoded.functionName !== "batchValueExecute") return;
    for (const call of decoded.args[0]) {
      if (call.to !== addresses.manager) continue;
      const [, , amount] = decodeFunctionData({ abi: EXECUTE, data: call.data }).args;
      balances.executor -= amount;
      landed.spends += 1;
    }
  }

  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      signRequests.push(tx);
      const hash = `0x${signRequests.length.toString(16).padStart(64, "0")}` as Hash;
      const reverts = revert.includes(signRequests.length) || burns(tx) > balances.executor;
      chain.set(hash, reverts ? "reverted" : "success");
      if (!reverts) apply(tx);
      return Promise.resolve(hash);
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash, chain.get(hash) ?? "success")),
    getReceipt: (hash) => Promise.resolve(chain.has(hash) ? receipt(hash, chain.get(hash)!) : null),
    isKnown: (hash) => Promise.resolve(chain.has(hash)),
  };

  const reader = fakeReader({
    deployed: true,
    collateral: 0n,
    credits: (holder) => (holder === addresses.executor ? balances.executor : balances.owner),
    manager: start.manager ?? 1000n * WAD,
    state: start.state,
    landed: () => ledger,
  });

  /** Records `hash` as mined with `status`, for a run stored with a hash this chain has seen. */
  const mined = (hash: Hash, status: "success" | "reverted") => void chain.set(hash, status);

  return { gateway, reader, balances, landed, signRequests, apply, mined };
}

/** 2 credits spent: 0.5 already in the trade wallet and 1.5 moved from the wallet; no money added. */
const request = (
  options = [option(1)],
): Omit<PredictSnapshot, "collateralAtStart" | "creditsAtStart" | "fromBlock"> => {
  const { collateralAtStart, creditsAtStart, fromBlock, ...rest } = snapshot({
    options,
    deposit: 0n,
    collateralIn: 0n,
    creditsFromEoa: (3n * WAD) / 2n,
    creditsToSpend: 2n * WAD,
  });
  void collateralAtStart;
  void creditsAtStart;
  void fromBlock;
  return rest;
};

/** The run's own credits transfer and first batch, as a tab that closed on them left them on chain. */
async function sent(stepId: string): Promise<FlowTx> {
  const snap = { ...request(), collateralAtStart: 0n, creditsAtStart: WAD / 2n, fromBlock: 1n };
  const deps = { reader: fakeReader(), quoter: fakeQuoter(), creditsQuoter: fakeCreditsQuoter() };
  return planPredict(snap, deps)
    .find((step) => step.id === stepId)!
    .build(ctx(), snap);
}

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

function drive(
  chain: ReturnType<typeof creditsChain>,
  store?: FlowRunStore,
  flowId = `credits-${drivers.length}`,
  options = [option(1)],
) {
  const driver = createPredictRun({
    gateway: chain.gateway,
    reader: { ...chain.reader, blockGasLimit: () => Promise.resolve(gasLimitFor(1)) },
    quoter: fakeQuoter(),
    creditsQuoter: fakeCreditsQuoter(),
    flowId,
    store,
    ctx: () => ctx(),
    snapshot: () => request(options),
  });
  drivers.push(driver);
  return driver;
}

const settled = (driver: PredictDriver) =>
  vi.waitFor(() => expect(["halted", "complete", "review"]).toContain(driver.getProgress().stage));

describe("a credits run, start to end", () => {
  it("moves the wallet's credits once and spends them once", async () => {
    const chain = creditsChain({ owner: 3n * WAD, executor: WAD / 2n });
    const driver = drive(chain);

    driver.start();
    await settled(driver);

    expect(driver.getProgress().stage).toBe("complete");
    expect(chain.landed).toEqual({ transfers: 1, spends: 1 });
    expect(chain.balances).toEqual({ owner: (3n * WAD) / 2n, executor: 0n });
  });

  it("refuses before signing anything when the manager cannot cover the credits", async () => {
    const chain = creditsChain({ owner: 3n * WAD, executor: WAD / 2n, manager: WAD });
    const driver = drive(chain);

    driver.start();
    await settled(driver);

    expect(driver.getProgress().failure?.reason).toBe("credits");
    expect(chain.signRequests).toEqual([]);
  });

  it("refuses before signing anything when the wallet no longer holds the credits it was shown", async () => {
    const chain = creditsChain({ owner: WAD, executor: WAD / 2n });
    const driver = drive(chain);

    driver.start();
    await settled(driver);

    expect(driver.getProgress().failure?.reason).toBe("balance");
    expect(chain.signRequests).toEqual([]);
  });
});

describe("credits across a retry (A7, A8)", () => {
  it("rebuilds a reverted first batch without moving the credits again, and spends them once", async () => {
    // sends: 1 the transfer, 2 the first batch (reverts), 3 the rebuilt batch
    const chain = creditsChain({ owner: 3n * WAD, executor: WAD / 2n }, [2]);
    const driver = drive(chain);

    driver.start();
    await settled(driver);
    expect(driver.getProgress().failure?.reason).toBe("reverted");
    // the credits wait in the trade wallet, owner-withdrawable, for the next attempt
    expect(chain.balances.executor).toBe(2n * WAD);

    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));

    expect(chain.landed).toEqual({ transfers: 1, spends: 1 });
    expect(chain.signRequests.filter((tx) => tx.to === addresses.credits)).toHaveLength(1);
  });
});

describe("credits withdrawn between a reverted first batch and its retry", () => {
  it("rebuilds the batch rather than read the missing credits as burned, so no prediction is reported that was not placed", async () => {
    const chain = creditsChain({ owner: 3n * WAD, executor: WAD / 2n }, [2]);
    const driver = drive(chain);

    driver.start();
    await settled(driver);
    expect(driver.getProgress().failure?.reason).toBe("reverted");

    // the owner withdraws the parked credits from the trade wallet, then presses Retry
    chain.balances.owner += chain.balances.executor;
    chain.balances.executor = 0n;
    driver.retry();
    await settled(driver);

    expect(driver.getProgress().stage).not.toBe("complete");
    expect(chain.signRequests.filter((tx) => tx.to === addresses.executor)).toHaveLength(2);
    expect(chain.landed.spends).toBe(0);
  });
});

describe("credits across recovery (A7)", () => {
  const FLOW_ID = "predict-credits-recovery";

  function savedRun(steps: StepSummary[], options = [option(1)]): FlowRunStore {
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    store.save<PredictSnapshot, PredictCtx>({
      flowId: FLOW_ID,
      adapterId: "predict-flow",
      status: "paused",
      reason: "rejected",
      ctx: ctx(),
      snapshot: {
        ...request(options),
        collateralAtStart: 0n,
        creditsAtStart: WAD / 2n,
        fromBlock: 1n,
        optionsPerBatch: 1,
      },
      steps,
    });
    return store;
  }

  const row = (stepId: string, outcome: StepSummary["outcome"]): StepSummary => ({ stepId, label: stepId, outcome });

  it("skips Add credits when the tab died with the transfer signed and the transfer shows it landed", async () => {
    const chain = creditsChain({
      owner: (3n * WAD) / 2n,
      executor: 2n * WAD,
      landed: [await sent(STEP_ID.addCredits)],
    });
    const store = savedRun([
      row(STEP_ID.createExecutor, { status: "skipped" }),
      row(STEP_ID.addCredits, { status: "awaiting-signature" }),
      row(STEP_ID.predict(1), { status: "pending" }),
    ]);
    const driver = drive(chain, store, FLOW_ID);

    driver.recover();
    await settled(driver);
    expect(driver.getProgress().stage).toBe("review");
    driver.resume();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));

    expect(chain.signRequests.filter((tx) => tx.to === addresses.credits)).toEqual([]);
    expect(chain.landed).toEqual({ transfers: 0, spends: 1 });
  });

  it("signs nothing when the transfer was signed as the tab died and the credits do not show it yet", async () => {
    const chain = creditsChain({ owner: 3n * WAD, executor: WAD / 2n });
    const store = savedRun([
      row(STEP_ID.createExecutor, { status: "skipped" }),
      row(STEP_ID.addCredits, { status: "awaiting-signature" }),
      row(STEP_ID.predict(1), { status: "pending" }),
    ]);
    const driver = drive(chain, store, FLOW_ID);

    driver.recover();
    await settled(driver);

    expect(driver.getProgress().failure?.reason).toBe("deposit-unconfirmed");
    expect(
      predictSteps({ wallet: null, toAdd: 0n, symbol: "sDAI", decimals: 18, progress: driver.getProgress() }).failure,
    ).toMatch(/still be confirming/);
    expect(chain.signRequests).toEqual([]);
  });

  it("signs nothing again when the tab died with the first batch signed and it landed", async () => {
    const chain = creditsChain({ owner: (3n * WAD) / 2n, executor: 0n, landed: [await sent(STEP_ID.predict(1))] });
    const store = savedRun([
      row(STEP_ID.createExecutor, { status: "skipped" }),
      row(STEP_ID.addCredits, { status: "confirmed", hash: `0x${"a".repeat(64)}`, blockNumber: 1n }),
      row(STEP_ID.predict(1), { status: "awaiting-signature" }),
    ]);
    const driver = drive(chain, store, FLOW_ID);

    driver.recover();
    await settled(driver);
    driver.resume();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));

    expect(chain.signRequests).toEqual([]);
    expect(chain.landed.spends).toBe(0);
  });

  const confirmed = (letter: string): StepSummary["outcome"] => ({
    status: "confirmed",
    hash: `0x${letter.repeat(64)}`,
    blockNumber: 1n,
  });
  const transfers = (chain: ReturnType<typeof creditsChain>) =>
    chain.signRequests.filter((tx) => tx.to === addresses.credits);
  const batches = (chain: ReturnType<typeof creditsChain>) =>
    chain.signRequests.filter((tx) => tx.to === addresses.executor);

  it("moves the credits once when the transfer was in flight at recovery and lands before the retry", async () => {
    const chain = creditsChain({ owner: 3n * WAD, executor: WAD / 2n });
    const store = savedRun([
      row(STEP_ID.createExecutor, { status: "skipped" }),
      row(STEP_ID.addCredits, { status: "awaiting-signature" }),
      row(STEP_ID.predict(1), { status: "pending" }),
    ]);
    const driver = drive(chain, store, FLOW_ID);

    driver.recover();
    await settled(driver);
    expect(driver.getProgress().failure?.reason).toBe("deposit-unconfirmed");

    // the transfer signed as the tab died mines while the visitor waits
    chain.apply(await sent(STEP_ID.addCredits));
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));

    expect(transfers(chain)).toEqual([]);
    expect(chain.landed.spends).toBe(1);
    expect(chain.balances).toEqual({ owner: (3n * WAD) / 2n, executor: 0n });
  });

  it("rebuilds the first batch once when Add credits had landed and the batch was not yet signed", async () => {
    const chain = creditsChain({ owner: (3n * WAD) / 2n, executor: 2n * WAD });
    const store = savedRun([
      row(STEP_ID.createExecutor, { status: "skipped" }),
      row(STEP_ID.addCredits, confirmed("a")),
      row(STEP_ID.predict(1), { status: "pending" }),
    ]);
    const driver = drive(chain, store, FLOW_ID);

    driver.recover();
    await settled(driver);
    driver.resume();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));

    expect(transfers(chain)).toEqual([]);
    expect(batches(chain)).toHaveLength(1);
    expect(chain.landed).toEqual({ transfers: 0, spends: 1 });
  });

  it("rebuilds the first batch once when it was signed as the tab died and its credits are not burned", async () => {
    const chain = creditsChain({ owner: (3n * WAD) / 2n, executor: 2n * WAD });
    const store = savedRun([
      row(STEP_ID.createExecutor, { status: "skipped" }),
      row(STEP_ID.addCredits, confirmed("a")),
      row(STEP_ID.predict(1), { status: "awaiting-signature" }),
    ]);
    const driver = drive(chain, store, FLOW_ID);

    driver.recover();
    await settled(driver);
    expect(driver.getProgress().stage).toBe("review");
    driver.resume();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));

    expect(transfers(chain)).toEqual([]);
    expect(batches(chain)).toHaveLength(1);
    expect(chain.landed).toEqual({ transfers: 0, spends: 1 });
    expect(chain.balances.executor).toBe(0n);
  });

  it("rebuilds a first batch found reverted at recovery without moving the credits again", async () => {
    const chain = creditsChain({ owner: (3n * WAD) / 2n, executor: 2n * WAD });
    const sent: Hash = `0x${"b".repeat(64)}`;
    chain.mined(sent, "reverted");
    const store = savedRun([
      row(STEP_ID.createExecutor, { status: "skipped" }),
      row(STEP_ID.addCredits, confirmed("a")),
      row(STEP_ID.predict(1), { status: "submitted", hash: sent }),
    ]);
    const driver = drive(chain, store, FLOW_ID);

    driver.recover();
    await settled(driver);
    expect(driver.getProgress().failure).toEqual({ reason: "reverted", retryable: true });
    expect(chain.signRequests).toEqual([]);

    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));

    expect(transfers(chain)).toEqual([]);
    expect(chain.landed).toEqual({ transfers: 0, spends: 1 });
  });

  it("signs nothing again when the first batch's hash was kept and it mined while the tab was away", async () => {
    const chain = creditsChain({ owner: (3n * WAD) / 2n, executor: 0n });
    const sent: Hash = `0x${"b".repeat(64)}`;
    chain.mined(sent, "success");
    const store = savedRun([
      row(STEP_ID.createExecutor, { status: "skipped" }),
      row(STEP_ID.addCredits, confirmed("a")),
      row(STEP_ID.predict(1), { status: "submitted", hash: sent }),
    ]);
    const driver = drive(chain, store, FLOW_ID);

    driver.recover();
    await settled(driver);
    driver.resume();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));

    expect(chain.signRequests).toEqual([]);
  });

  it("spends no credits in a later batch when the tab died after the first one landed", async () => {
    // the first batch's split left every option its underlying
    const chain = creditsChain({
      owner: (3n * WAD) / 2n,
      executor: 0n,
      state: () => chainState({ underlying: 2n * WAD }),
    });
    const options = [option(1), option(2)];
    const store = savedRun(
      [
        row(STEP_ID.createExecutor, { status: "skipped" }),
        row(STEP_ID.addCredits, confirmed("a")),
        row(STEP_ID.predict(1), confirmed("b")),
        row(STEP_ID.predict(2), { status: "awaiting-signature" }),
      ],
      options,
    );
    const driver = drive(chain, store, FLOW_ID, options);

    driver.recover();
    await settled(driver);
    driver.resume();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));

    expect(transfers(chain)).toEqual([]);
    expect(batches(chain)).toHaveLength(1);
    const [second] = batches(chain);
    const decoded = decodeFunctionData({ abi: tradeExecutorAbi, data: second!.data! });
    if (decoded.functionName !== "batchExecute" && decoded.functionName !== "batchValueExecute") {
      throw new Error(`Expected a batch, got ${decoded.functionName}`);
    }
    expect(decoded.args[0].map((call) => call.to)).not.toContain(addresses.manager);
  });

  it("signs nothing again when a first batch signed with no hash is recovered twice before it is resumed", async () => {
    const chain = creditsChain({ owner: (3n * WAD) / 2n, executor: 0n, landed: [await sent(STEP_ID.predict(1))] });
    const store = savedRun([
      row(STEP_ID.createExecutor, { status: "skipped" }),
      row(STEP_ID.addCredits, confirmed("a")),
      row(STEP_ID.predict(1), { status: "awaiting-signature" }),
    ]);
    // the popup is opened and closed once before the visitor resumes
    const first = drive(chain, store, FLOW_ID);
    first.recover();
    await settled(first);
    first.dispose();

    const driver = drive(chain, store, FLOW_ID);
    driver.recover();
    await settled(driver);
    driver.resume();
    await settled(driver);

    expect(driver.getProgress().stage, JSON.stringify(driver.getProgress().failure)).toBe("complete");
    expect(chain.signRequests).toEqual([]);
  });

  it("signs nothing again when one driver recovers the same run twice, as a remounted popup does", async () => {
    const chain = creditsChain({ owner: (3n * WAD) / 2n, executor: 0n, landed: [await sent(STEP_ID.predict(1))] });
    const store = savedRun([
      row(STEP_ID.createExecutor, { status: "skipped" }),
      row(STEP_ID.addCredits, confirmed("a")),
      row(STEP_ID.predict(1), { status: "awaiting-signature" }),
    ]);
    const driver = drive(chain, store, FLOW_ID);

    driver.recover();
    await settled(driver);
    driver.dispose();
    driver.recover();
    await settled(driver);
    driver.resume();
    await settled(driver);

    expect(driver.getProgress().stage, JSON.stringify(driver.getProgress().failure)).toBe("complete");
    expect(chain.signRequests).toEqual([]);
  });

  it("reads withdrawn credits as withdrawn once the recovered run's rebuilt batch reverts", async () => {
    // the rebuilt first batch is the first send, and reverts
    const chain = creditsChain({ owner: (3n * WAD) / 2n, executor: 2n * WAD }, [1]);
    const store = savedRun([
      row(STEP_ID.createExecutor, { status: "skipped" }),
      row(STEP_ID.addCredits, confirmed("a")),
      row(STEP_ID.predict(1), { status: "awaiting-signature" }),
    ]);
    const driver = drive(chain, store, FLOW_ID);

    driver.recover();
    await settled(driver);
    driver.resume();
    await settled(driver);
    expect(driver.getProgress().failure?.reason).toBe("reverted");

    chain.balances.owner += chain.balances.executor;
    chain.balances.executor = 0n;
    driver.retry();
    await settled(driver);

    expect(driver.getProgress().stage).not.toBe("complete");
    expect(chain.landed.spends).toBe(0);
  });

  it("reads withdrawn credits as withdrawn when a reload finds the rebuilt batch reverted", async () => {
    const chain = creditsChain({ owner: 2n * WAD, executor: 0n });
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    store.save<PredictSnapshot, PredictCtx>({
      flowId: FLOW_ID,
      adapterId: "predict-flow",
      status: "failed",
      error: { stepId: STEP_ID.predict(1), message: "reverted", cause: "reverted", hash: `0x${"c".repeat(64)}` },
      ctx: ctx(),
      snapshot: { ...request(), collateralAtStart: 0n, creditsAtStart: WAD / 2n, fromBlock: 1n },
      steps: [
        row(STEP_ID.createExecutor, { status: "skipped" }),
        row(STEP_ID.addCredits, confirmed("a")),
        row(STEP_ID.predict(1), { status: "pending" }),
      ],
    });
    const driver = drive(chain, store, FLOW_ID);

    driver.recover();
    await settled(driver);
    expect(driver.getProgress().stage).toBe("review");
    driver.resume();
    await settled(driver);

    expect(driver.getProgress().stage).not.toBe("complete");
    expect(chain.landed.spends).toBe(0);
  });

  it("pins the trade wallet's credits and the block after the latest as the run starts, before anything moves", async () => {
    const chain = creditsChain({ owner: 3n * WAD, executor: WAD / 2n });
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const driver = drive(chain, store, "credits-pinned");
    const saved: PredictSnapshot[] = [];
    const save = store.save.bind(store);
    store.save = (run) => {
      saved.push(run.snapshot as PredictSnapshot);
      save(run);
    };

    driver.start();
    await settled(driver);

    expect(saved[0]?.creditsAtStart).toBe(WAD / 2n);
    // the fake chain's latest block is 1: an earlier run's transactions in it are not this run's
    expect(saved[0]?.fromBlock).toBe(2n);
  });
});

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
  ctx,
  fakeCreditsQuoter,
  fakeQuoter,
  fakeReader,
  snapshot,
  WAD,
} from "../../flow/__tests__/support/fakes";
import { STEP_ID } from "../../flow/plan";
import type { PredictCtx, PredictSnapshot } from "../../flow/types";
import { predictSteps } from "../../utils/predictSteps";
import { createPredictRun } from "../driver";
import type { PredictDriver } from "../types";

const TRANSFER = parseAbi(["function transfer(address to, uint256 amount)"]);
const EXECUTE = parseAbi(["function execute(address to, bytes data, uint256 amount, address outputToken)"]);

/**
 * A chain that keeps the credits: a transfer moves them from the owner to the trade wallet, a
 * landed first batch burns what its `execute` names. `revert` lists the sends that revert.
 */
function creditsChain(start: { owner: bigint; executor: bigint; manager?: bigint }, revert: number[] = []) {
  const balances = { owner: start.owner, executor: start.executor };
  const signRequests: FlowTx[] = [];
  const landed = { transfers: 0, spends: 0 };
  const chain = new Map<Hash, "success" | "reverted">();
  const receipt = (hash: Hash, status: "success" | "reverted") =>
    ({ transactionHash: hash, status, blockNumber: 19_000_000n }) as TransactionReceipt;

  /** What `tx` does to the credits, applied when it lands. */
  function apply(tx: FlowTx) {
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
      const reverts = revert.includes(signRequests.length);
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
  });

  return { gateway, reader, balances, landed, signRequests, apply };
}

/** 2 credits spent: 0.5 already in the trade wallet and 1.5 moved from the wallet; no money added. */
const request = (): Omit<PredictSnapshot, "collateralAtStart" | "creditsAtStart"> => {
  const { collateralAtStart, creditsAtStart, ...rest } = snapshot({
    deposit: 0n,
    collateralIn: 0n,
    creditsFromEoa: (3n * WAD) / 2n,
    creditsToSpend: 2n * WAD,
  });
  void collateralAtStart;
  void creditsAtStart;
  return rest;
};

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

function drive(chain: ReturnType<typeof creditsChain>, store?: FlowRunStore, flowId = `credits-${drivers.length}`) {
  const driver = createPredictRun({
    gateway: chain.gateway,
    reader: chain.reader,
    quoter: fakeQuoter(),
    creditsQuoter: fakeCreditsQuoter(),
    flowId,
    store,
    ctx: () => ctx(),
    snapshot: request,
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

describe("credits across recovery (A7)", () => {
  const FLOW_ID = "predict-credits-recovery";

  function savedRun(steps: StepSummary[]): FlowRunStore {
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    store.save<PredictSnapshot, PredictCtx>({
      flowId: FLOW_ID,
      adapterId: "predict-flow",
      status: "paused",
      reason: "rejected",
      ctx: ctx(),
      snapshot: { ...request(), collateralAtStart: 0n, creditsAtStart: WAD / 2n },
      steps,
    });
    return store;
  }

  const row = (stepId: string, outcome: StepSummary["outcome"]): StepSummary => ({ stepId, label: stepId, outcome });

  it("skips Add credits when the tab died with the transfer signed and the credits show it landed", async () => {
    const chain = creditsChain({ owner: (3n * WAD) / 2n, executor: 2n * WAD });
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

  it("signs nothing again when the tab died with the first batch signed and its credits already burned", async () => {
    const chain = creditsChain({ owner: (3n * WAD) / 2n, executor: 0n });
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

  it("pins the trade wallet's credits as the run starts, before anything moves", async () => {
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
  });
});

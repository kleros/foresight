import {
  createFlowRunStore,
  createMemoryStorage,
  type FlowRunStore,
  type FlowTx,
  type StepSummary,
  type TxGateway,
} from "@foresight/tx-orchestrator";
import { decodeFunctionData, encodeFunctionData, parseAbi, type Hash, type TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { gnosisRouterAbi, tradeExecutorAbi } from "@/config/contracts";
import { batchExecuteTx } from "@/lib/trade-executor/executor";

import {
  addresses,
  ctx,
  fakeCreditsQuoter,
  fakeQuoter,
  fakeReader,
  landedTx,
  mintLog,
  option,
  snapshot,
  VAULT_RATE,
  WAD,
} from "../../flow/__tests__/support/fakes";
import { STEP_ID } from "../../flow/plan";
import type { LandedTx, PredictCtx, PredictSnapshot } from "../../flow/types";
import { createPredictRun } from "../driver";
import type { PredictDriver } from "../types";

const TRANSFER = parseAbi(["function transfer(address to, uint256 amount)"]);
const EXECUTE = parseAbi(["function execute(address to, bytes data, uint256 amount, address outputToken)"]);

function batchCalls(tx: FlowTx) {
  if (tx.to !== addresses.executor || !tx.data) return [];
  const decoded = decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data });
  if (decoded.functionName !== "batchValueExecute" && decoded.functionName !== "batchExecute") return [];
  return decoded.args[0].map((call) => ({ to: call.to, data: call.data }));
}

/** sDAI the batch splits at the parent market. */
function parentSplit(tx: FlowTx): bigint {
  let sum = 0n;
  for (const call of batchCalls(tx)) {
    if (call.to !== addresses.router) continue;
    const decoded = decodeFunctionData({ abi: gnosisRouterAbi, data: call.data });
    if (decoded.functionName === "splitPosition" && decoded.args[1] === addresses.parentMarket) sum += decoded.args[2];
  }
  return sum;
}

const burns = (tx: FlowTx): bigint =>
  batchCalls(tx)
    .filter((call) => call.to === addresses.manager)
    .reduce((sum, call) => sum + decodeFunctionData({ abi: EXECUTE, data: call.data }).args[2], 0n);

/** What the fake vault mints for an xDAI deposit. */
const mintedFor = (xdai: bigint) => (xdai * WAD) / VAULT_RATE;

/**
 * A chain holding the trade wallet's credits and sDAI. What lands is kept in a ledger the reader
 * reads back as the owner's landed transactions; `hold` keeps a send in the mempool until `mine`.
 */
function moneyChain(start: { owner: bigint; executorCredits: bigint; collateral: bigint; landed?: LandedTx[] }) {
  const balances = { owner: start.owner, executor: start.executorCredits, collateral: start.collateral };
  const signRequests: FlowTx[] = [];
  const ledger: LandedTx[] = [...(start.landed ?? [])];
  const landed = { transfers: 0, spends: 0, batches: 0, deposits: 0, split: 0n };
  const chain = new Map<Hash, { status: "success" | "reverted"; minted: bigint }>();
  const held = new Map<Hash, FlowTx>();
  let hold = false;

  const receipt = (hash: Hash): TransactionReceipt => {
    const mined = chain.get(hash)!;
    return {
      transactionHash: hash,
      status: mined.status,
      blockNumber: 19_000_000n,
      logs: mined.minted > 0n ? [mintLog(mined.minted)] : [],
    } as unknown as TransactionReceipt;
  };

  /** Lands `tx` if the chain lets it, and returns what it minted into the trade wallet. */
  function land(hash: Hash, tx: FlowTx) {
    const reverts = burns(tx) > balances.executor || parentSplit(tx) > balances.collateral;
    let minted = 0n;
    if (!reverts) {
      if (tx.to === addresses.credits) {
        const [, amount] = decodeFunctionData({ abi: TRANSFER, data: tx.data! }).args;
        balances.owner -= amount;
        balances.executor += amount;
        landed.transfers += 1;
      } else if (tx.to === addresses.sDaiAdapter) {
        minted = mintedFor(tx.value ?? 0n);
        balances.collateral += minted;
        landed.deposits += 1;
      } else if (tx.to === addresses.executor) {
        const burned = burns(tx);
        if (burned > 0n) landed.spends += 1;
        balances.executor -= burned;
        const split = parentSplit(tx);
        balances.collateral -= split;
        landed.split += split;
        landed.batches += 1;
      }
      ledger.push(landedTx(tx, minted));
    }
    chain.set(hash, { status: reverts ? "reverted" : "success", minted });
  }

  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      signRequests.push(tx);
      const hash = `0x${signRequests.length.toString(16).padStart(64, "0")}` as Hash;
      if (hold) held.set(hash, tx);
      else land(hash, tx);
      return Promise.resolve(hash);
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
    getReceipt: (hash) => Promise.resolve(chain.has(hash) ? receipt(hash) : null),
    isKnown: (hash) => Promise.resolve(chain.has(hash) || held.has(hash)),
  };

  const base = fakeReader({
    deployed: true,
    credits: (holder) => (holder === addresses.executor ? balances.executor : balances.owner),
    landed: () => ledger,
    pending: () => held.size > 0,
  });
  const reader = { ...base, collateralBalance: () => Promise.resolve(balances.collateral) };

  return {
    gateway,
    reader,
    balances,
    landed,
    signRequests,
    /** Sends from now on wait in the mempool. */
    holdSends: () => void (hold = true),
    /** Mines everything waiting, and lets later sends land at once. */
    mine: () => {
      hold = false;
      for (const [hash, tx] of held) land(hash, tx);
      held.clear();
    },
  };
}

type Request = Omit<PredictSnapshot, "collateralAtStart" | "creditsAtStart" | "fromBlock">;

const request = (overrides: Partial<PredictSnapshot>): Request => {
  const { collateralAtStart, creditsAtStart, fromBlock, ...rest } = snapshot(overrides);
  void collateralAtStart;
  void creditsAtStart;
  void fromBlock;
  return rest;
};

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

function drive(chain: ReturnType<typeof moneyChain>, req: Request, store?: FlowRunStore, flowId = "witness") {
  const driver = createPredictRun({
    gateway: chain.gateway,
    reader: chain.reader,
    quoter: fakeQuoter(),
    creditsQuoter: fakeCreditsQuoter(),
    flowId,
    store,
    ctx: () => ctx(),
    snapshot: () => req,
  });
  drivers.push(driver);
  return driver;
}

const settled = (driver: PredictDriver) =>
  vi.waitFor(() => expect(["halted", "complete", "review"]).toContain(driver.getProgress().stage));

const row = (stepId: string, outcome: StepSummary["outcome"]): StepSummary => ({ stepId, label: stepId, outcome });
const confirmed = (letter: string): StepSummary["outcome"] => ({
  status: "confirmed",
  hash: `0x${letter.repeat(64)}`,
  blockNumber: 1n,
});

function stored(snap: PredictSnapshot, steps: StepSummary[]): FlowRunStore {
  const store = createFlowRunStore({ storage: createMemoryStorage() });
  store.save<PredictSnapshot, PredictCtx>({
    flowId: "witness",
    adapterId: "predict-flow",
    status: "paused",
    reason: "rejected",
    ctx: ctx(),
    snapshot: snap,
    steps,
  });
  return store;
}

/** A first batch of `run` as it landed: it splits the run's sDAI at `parentMarket`. */
const landedBatch = (collateralIn: bigint, parentMarket = addresses.parentMarket): LandedTx =>
  landedTx(
    batchExecuteTx(addresses.executor, [
      {
        to: addresses.router,
        data: encodeFunctionData({
          abi: gnosisRouterAbi,
          functionName: "splitPosition",
          args: [addresses.collateral, parentMarket, collateralIn],
        }),
      },
    ]),
  );

describe("a first batch is witnessed by its own transaction, not by balances", () => {
  it("does not sign and spend a first batch again on Retry when the node took it but the wallet's reply was lost", async () => {
    // 5 credits spent from the 10 the trade wallet holds, plus 2 sDAI from its 10
    const chain = moneyChain({ owner: 0n, executorCredits: 10n * WAD, collateral: 10n * WAD });
    const send = chain.gateway.sendTransaction;
    let failed = false;
    chain.gateway.sendTransaction = async (tx, opts) => {
      const hash = await send(tx, opts);
      if (tx.to === addresses.executor && !failed) {
        failed = true;
        throw new Error("Request timed out");
      }
      return hash;
    };
    const driver = drive(
      chain,
      request({ deposit: 0n, collateralIn: 2n * WAD, collateralBefore: 10n * WAD, creditsToSpend: 5n * WAD }),
    );

    driver.start();
    await settled(driver);
    expect(chain.landed.spends).toBe(1);
    driver.retry();
    await settled(driver);

    expect({ spends: chain.landed.spends, split: chain.landed.split }).toEqual({ spends: 1, split: 2n * WAD });
    expect(driver.getProgress().stage).toBe("complete");
  });

  it("signs nothing on Retry while a first batch whose reply was lost is still in the mempool", async () => {
    const chain = moneyChain({ owner: 0n, executorCredits: 10n * WAD, collateral: 10n * WAD });
    const send = chain.gateway.sendTransaction;
    chain.gateway.sendTransaction = async (tx, opts) => {
      if (tx.to !== addresses.executor) return send(tx, opts);
      chain.holdSends();
      await send(tx, opts);
      throw new Error("Request timed out");
    };
    const driver = drive(
      chain,
      request({ deposit: 0n, collateralIn: 2n * WAD, collateralBefore: 10n * WAD, creditsToSpend: 5n * WAD }),
    );

    driver.start();
    await settled(driver);
    driver.retry();
    await settled(driver);

    expect(driver.getProgress().failure?.reason).toBe("pending");
    expect(chain.signRequests.filter((tx) => tx.to === addresses.executor)).toHaveLength(1);

    chain.mine();
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));
    expect({ spends: chain.landed.spends, split: chain.landed.split }).toEqual({ spends: 1, split: 2n * WAD });
  });

  it("does not read credits withdrawn while the run sat unfinished as a landed first batch", async () => {
    // Add credits landed, batch 1 was open in the wallet as the tab closed and never signed;
    // the owner then withdrew the 2 credits from the trade wallet
    const chain = moneyChain({ owner: 3n * WAD, executorCredits: 0n, collateral: 0n });
    const snap = {
      ...request({ deposit: 0n, collateralIn: 0n, creditsFromEoa: (3n * WAD) / 2n, creditsToSpend: 2n * WAD }),
      collateralAtStart: 0n,
      creditsAtStart: WAD / 2n,
      fromBlock: 1n,
    };
    const store = stored(snap, [
      row(STEP_ID.createExecutor, { status: "skipped" }),
      row(STEP_ID.addCredits, confirmed("a")),
      row(STEP_ID.predict(1), { status: "awaiting-signature" }),
    ]);
    const driver = drive(chain, snap, store);

    driver.recover();
    await settled(driver);
    driver.resume();
    await settled(driver);

    expect(chain.landed.batches).toBe(0);
    expect(driver.getProgress().stage, "a prediction reported as placed with no batch on chain").not.toBe("complete");
  });

  it("does not read another session's run spending the trade wallet's credits as this run's first batch", async () => {
    // this run left batch 1 unsigned; a run in another session then burned the trade wallet's credits
    const other = "0x00000000000000000000000000000000000000ff" as const;
    const chain = moneyChain({ owner: 0n, executorCredits: 0n, collateral: 0n, landed: [landedBatch(WAD, other)] });
    const snap = {
      ...request({ deposit: 0n, collateralIn: 0n, creditsToSpend: 2n * WAD }),
      collateralAtStart: 0n,
      creditsAtStart: 2n * WAD,
      fromBlock: 1n,
    };
    const store = stored(snap, [
      row(STEP_ID.createExecutor, { status: "skipped" }),
      row(STEP_ID.predict(1), { status: "awaiting-signature" }),
    ]);
    const driver = drive(chain, snap, store);

    driver.recover();
    await settled(driver);
    driver.resume();
    await settled(driver);

    expect(driver.getProgress().stage, "reported placed with nothing traded").not.toBe("complete");
  });

  it("does not sign an sDAI run's first batch again on reload when it landed as the tab closed", async () => {
    // 2 of the trade wallet's 10 sDAI; batch 1 mined after the tab closed, leaving 8
    const chain = moneyChain({ owner: 0n, executorCredits: 0n, collateral: 8n * WAD, landed: [landedBatch(2n * WAD)] });
    const snap = {
      ...request({ deposit: 0n, collateralIn: 2n * WAD, collateralBefore: 10n * WAD }),
      collateralAtStart: 10n * WAD,
      creditsAtStart: 0n,
      fromBlock: 1n,
    };
    const store = stored(snap, [
      row(STEP_ID.createExecutor, { status: "skipped" }),
      row(STEP_ID.predict(1), { status: "awaiting-signature" }),
    ]);
    const driver = drive(chain, snap, store);

    driver.recover();
    await settled(driver);
    driver.resume();
    await settled(driver);

    expect(chain.landed.split, "sDAI split a second time").toBe(0n);
    expect(driver.getProgress().stage).toBe("complete");
  });
});

describe("an xDAI deposit is witnessed by its own transaction", () => {
  it("does not take sDAI that reached the trade wallet some other way as the deposit, nor split it", async () => {
    // the deposit was open in the wallet as the tab closed and never sent; the owner then put
    // 50 sDAI into the trade wallet from the Trade wallet panel
    const chain = moneyChain({ owner: 0n, executorCredits: 0n, collateral: 50n * WAD });
    const shown = mintedFor(WAD);
    const snap = {
      ...request({ deposit: WAD, depositNative: true, collateralIn: shown, collateralBefore: 0n }),
      collateralAtStart: 0n,
      creditsAtStart: 0n,
      fromBlock: 1n,
    };
    const store = stored(snap, [
      row(STEP_ID.createExecutor, { status: "skipped" }),
      row(STEP_ID.deposit, { status: "awaiting-signature" }),
      row(STEP_ID.predict(1), { status: "pending" }),
    ]);
    const driver = drive(chain, snap, store);

    driver.recover();
    await settled(driver);
    // not seen on chain, so it may still be confirming; a retry reads it again before signing
    expect(driver.getProgress().failure?.reason).toBe("deposit-unconfirmed");
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));

    expect(chain.landed.deposits).toBe(1);
    expect(chain.landed.split, "split no more than the sDAI the popup showed").toBe(shown);
  });

  it("splits what a deposit that landed as the tab closed minted, not the trade wallet's balance", async () => {
    const shown = mintedFor(WAD);
    const snap = {
      ...request({ deposit: WAD, depositNative: true, collateralIn: shown, collateralBefore: 0n }),
      collateralAtStart: 0n,
      creditsAtStart: 0n,
      fromBlock: 1n,
    };
    // the deposit mined as the tab closed: one wei under the preview, as a vault rate step leaves it
    const deposit = {
      to: addresses.sDaiAdapter,
      value: WAD,
      data: encodeFunctionData({
        abi: parseAbi(["function depositXDAI(address receiver)"]),
        functionName: "depositXDAI",
        args: [addresses.executor],
      }),
    };
    const chain = moneyChain({
      owner: 0n,
      executorCredits: 0n,
      collateral: 50n * WAD + shown - 1n,
      landed: [landedTx(deposit, shown - 1n)],
    });
    const store = stored(snap, [
      row(STEP_ID.createExecutor, { status: "skipped" }),
      row(STEP_ID.deposit, { status: "awaiting-signature" }),
      row(STEP_ID.predict(1), { status: "pending" }),
    ]);
    const driver = drive(chain, snap, store);

    driver.recover();
    await settled(driver);
    expect(driver.getProgress().stage).toBe("review");
    driver.resume();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));

    expect(chain.signRequests.filter((tx) => tx.to === addresses.sDaiAdapter)).toEqual([]);
    expect(chain.landed.split).toBe(shown - 1n);
  });
});

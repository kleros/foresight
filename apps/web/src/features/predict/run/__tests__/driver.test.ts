import { createFlowRunStore, createMemoryStorage, type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import { decodeFunctionData, type Hash, type Hex, type Log, type TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { depositTx } from "@/lib/trade-executor/funding";

import { gnosisRouterAbi, tradeExecutorAbi } from "@/config/contracts";

import {
  addresses,
  chainState,
  ctx,
  fakeQuoter,
  fakeReader,
  landedTx,
  mintLog,
  option,
  snapshot,
  WAD,
} from "../../flow/__tests__/support/fakes";
import { STEP_ID } from "../../flow/plan";
import type { OptionChainState, PredictReader, PredictSnapshot } from "../../flow/types";
import { planFunding } from "../../utils/funding";
import { MIN_LEG_WEI } from "../../utils/plan";
import { sqrtPriceX96FromPrice } from "../../utils/poolMath";
import { predictSteps } from "../../utils/predictSteps";
import { createPredictRun } from "../driver";
import type { PredictDriver, PredictProgress } from "../types";

/** A wallet that signs everything and a chain that mines it; `logs` are what each mined transaction emits. */
function fakeGateway(logs: (tx: FlowTx) => Log[] = () => []): TxGateway & { readonly signRequests: FlowTx[] } {
  const signRequests: FlowTx[] = [];
  const receipt = (hash: Hash): TransactionReceipt => {
    const tx = signRequests[Number(BigInt(hash)) - 1];
    return {
      transactionHash: hash,
      status: "success",
      blockNumber: 19_000_000n,
      logs: tx ? logs(tx) : [],
    } as unknown as TransactionReceipt;
  };

  return {
    signRequests,
    sendTransaction: (tx) => {
      signRequests.push(tx);
      return Promise.resolve(`0x${signRequests.length.toString(16).padStart(64, "0")}` as Hash);
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
    getReceipt: (hash) => Promise.resolve(receipt(hash)),
    isKnown: () => Promise.resolve(true),
  };
}

/** A collateral transfer or an xDAI payment to the adapter: money into the trade wallet. */
const isDeposit = (tx: FlowTx) => tx.to === addresses.collateral || tx.to === addresses.sDaiAdapter;

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

async function runToEnd(snap: PredictSnapshot, state: () => OptionChainState) {
  return runToEndWith(snap, fakeReader({ deployed: true, state }));
}

async function runToEndWith(snap: PredictSnapshot, reader: PredictReader) {
  const gateway = fakeGateway();
  const driver = createPredictRun({
    gateway,
    reader,
    quoter: fakeQuoter(),
    flowId: `predict-test-${drivers.length}`,
    ctx: () => ctx(),
    snapshot: () => snap,
  });
  drivers.push(driver);

  driver.start();
  await vi.waitFor(() => expect(["halted", "complete"]).toContain(driver.getProgress().stage));

  return { progress: driver.getProgress(), deposits: gateway.signRequests.filter(isDeposit) };
}

/** What the popup says about a halted run. */
const message = (progress: PredictProgress) =>
  predictSteps({ wallet: null, toAdd: 0n, symbol: "sDAI", decimals: 18, progress }).failure;

const withReason = (progress: PredictProgress, reason: "rpc" | "unknown"): PredictProgress => ({
  ...progress,
  failure: { reason, retryable: reason === "rpc" },
});

/** Both pools already priced at the estimate, so nothing moves the market toward it. */
const atTarget = (targetPriceWad: bigint) => (): OptionChainState =>
  chainState({
    pools: {
      up: {
        sqrtPriceX96: sqrtPriceX96FromPrice(targetPriceWad, true),
        liquidity: WAD,
        tick: 0,
        fee: 0n,
        ticks: [],
        outcomeIsToken0: true,
      },
      down: {
        sqrtPriceX96: sqrtPriceX96FromPrice(WAD - targetPriceWad, true),
        liquidity: WAD,
        tick: 0,
        fee: 0n,
        ticks: [],
        outcomeIsToken0: true,
      },
    },
  });

function expectNoRouteHalt(result: Awaited<ReturnType<typeof runToEnd>>) {
  const { progress, deposits } = result;

  expect(progress.stage).toBe("halted");
  expect(progress.failure).toBeDefined();
  expect(progress.failure!.reason).not.toBe("rpc");
  expect(progress.failure!.retryable).toBe(false);
  expect(deposits).toEqual([]);

  const shown = message(progress);
  expect(shown).toBeDefined();
  expect(shown).not.toBe(message(withReason(progress, "rpc")));
  expect(shown).not.toBe(message(withReason(progress, "unknown")));
}

describe("createPredictRun when no route moves the market", () => {
  it.each([
    ["one wei", 1n],
    ["0.001 sDAI", 10n ** 15n],
    ["just under the smallest leg", MIN_LEG_WEI - 1n],
  ])("halts a dust amount (%s) before the deposit, without blaming the network", async (_, amount) => {
    const result = await runToEnd(snapshot({ deposit: amount, collateralIn: amount }), () => chainState());

    expectNoRouteHalt(result);
  });

  it.each([
    ["25%", WAD / 4n],
    ["50%", WAD / 2n],
    ["80%", (WAD * 4n) / 5n],
  ])("halts an estimate the market already sits at (%s) before the deposit", async (_, target) => {
    const result = await runToEnd(snapshot({ options: [option(1, target)] }), atTarget(target));

    expectNoRouteHalt(result);
  });

  it("tells a returning visitor with nothing to add and nothing held the same thing, not the network message", async () => {
    const returning = await runToEnd(snapshot({ deposit: 0n, collateralIn: 0n, collateralBefore: 0n }), () =>
      chainState(),
    );
    const dust = await runToEnd(snapshot({ deposit: 10n ** 15n, collateralIn: 10n ** 15n }), () => chainState());

    expect(returning.progress.stage).toBe("halted");
    expect(returning.progress.failure?.reason).not.toBe("rpc");
    expect(message(returning.progress)).not.toBe(message(withReason(returning.progress, "rpc")));
    expect(message(returning.progress)).toBe(message(dust.progress));
  });
});

/** The collateral a predict transaction splits at the session's parent. */
function parentSplit(data: Hex): bigint | undefined {
  const decoded = decodeFunctionData({ abi: tradeExecutorAbi, data });
  if (decoded.functionName !== "batchExecute") return undefined;
  for (const call of decoded.args[0]) {
    if (call.to !== addresses.router) continue;
    const inner = decodeFunctionData({ abi: gnosisRouterAbi, data: call.data });
    if (inner.functionName === "splitPosition") return inner.args[2];
  }
  return undefined;
}

describe("createPredictRun and the trade wallet's balance", () => {
  it("splits only the deposit and the shown share across generated stale balances", async () => {
    let seed = 20_261_008n;
    const next = (max: bigint) => {
      seed = (seed * 1_664_525n + 1_013_904_223n) % 2n ** 32n;
      return (seed * max) / 2n ** 32n;
    };
    const rate = (WAD * 5n) / 4n;
    for (let index = 0; index < 40; index++) {
      const real = next(50n * WAD);
      const cached = index % 4 === 0 ? 0n : next(real + 1n);
      const native = index % 2 === 0;
      const wanted = cached + WAD + next(30n * WAD);
      const amount = native ? (wanted * rate + WAD - 1n) / WAD : wanted;
      const funding = planFunding({
        amount,
        ownWallet: 100n * WAD,
        tradeWallet: cached,
        ...(native ? { tokenPerCollateralWad: rate } : {}),
      });
      const minted = native ? (funding.deposit * WAD) / rate : funding.deposit;
      const gateway = fakeGateway((tx) => (tx.to === addresses.sDaiAdapter ? [mintLog(minted)] : []));
      const driver = createPredictRun({
        gateway,
        reader: fakeReader({ deployed: true, collateral: real }),
        quoter: fakeQuoter(),
        flowId: `predict-generated-cache-${index}`,
        ctx: () => ctx(),
        snapshot: () =>
          snapshot({
            deposit: funding.deposit,
            depositNative: native,
            collateralIn: funding.collateralIn,
            collateralBefore: cached,
          }),
      });
      drivers.push(driver);
      driver.start();
      await vi.waitFor(() => expect(["halted", "complete"]).toContain(driver.getProgress().stage));

      expect(driver.getProgress().stage, `case ${index}`).toBe("complete");
      expect(gateway.signRequests.filter(isDeposit)).toHaveLength(1);
      const splits = gateway.signRequests.flatMap((tx) =>
        tx.to === addresses.executor ? (parentSplit(tx.data!) ?? []) : [],
      );
      expect(splits, `case ${index}`).toEqual([minted + funding.fromTradeWallet]);
      driver.dispose();
    }
  });

  it("splits what an xDAI deposit minted plus the share shown, when the cached balance was low", async () => {
    // the adapter mints 1 collateral per 2 xDAI here, so the minted amount is not the deposit
    const gateway = fakeGateway((tx) => (tx.to === addresses.sDaiAdapter ? [mintLog((tx.value ?? 0n) / 2n)] : []));
    const driver = createPredictRun({
      gateway,
      reader: fakeReader({ deployed: true, collateral: WAD * 5n }),
      quoter: fakeQuoter(),
      flowId: "predict-xdai-low-cache",
      ctx: () => ctx(),
      snapshot: () =>
        snapshot({ deposit: WAD * 12n, depositNative: true, collateralIn: WAD * 9n, collateralBefore: WAD * 3n }),
    });
    drivers.push(driver);

    driver.start();
    await vi.waitFor(() => expect(["halted", "complete"]).toContain(driver.getProgress().stage));

    expect(driver.getProgress().stage).toBe("complete");
    expect(gateway.signRequests.filter(isDeposit)).toHaveLength(1);
    const splits = gateway.signRequests.flatMap((tx) =>
      tx.to === addresses.executor ? (parentSplit(tx.data!) ?? []) : [],
    );
    expect(splits).toEqual([WAD * 6n + WAD * 3n]);
  });

  it("goes ahead when the cache is high but the trade wallet still covers the amount", async () => {
    const result = await runToEndWith(
      snapshot({ deposit: 0n, collateralIn: WAD * 4n, collateralBefore: WAD * 6n }),
      fakeReader({ deployed: true, collateral: WAD * 5n }),
    );

    expect(result.progress.stage).toBe("complete");
  });

  it("resumes a recovered run whose deposit already landed without asking for it again", async () => {
    const snap = snapshot({ deposit: WAD * 3n, collateralIn: WAD * 5n, collateralBefore: WAD * 2n });
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const flowId = "predict-recovered-landed";
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
          outcome: { status: "confirmed", hash: `0x${"a".repeat(64)}`, blockNumber: 1n },
        },
        { stepId: STEP_ID.deposit, label: "Add money to your trade wallet", outcome: { status: "awaiting-signature" } },
        { stepId: STEP_ID.predict(1), label: "Making your prediction", outcome: { status: "pending" } },
      ],
    });
    const gateway = fakeGateway();
    // the deposit signed as the tab closed mined meanwhile
    const deposit = depositTx({
      executor: addresses.executor,
      asset: { token: addresses.collateral, amount: WAD * 3n },
    });
    const driver = createPredictRun({
      gateway,
      reader: fakeReader({ deployed: true, collateral: WAD * 5n, landed: [landedTx(deposit)] }),
      quoter: fakeQuoter(),
      flowId,
      store,
      ctx: () => ctx(),
      snapshot: () => snap,
    });
    drivers.push(driver);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("review"));
    expect(gateway.signRequests).toEqual([]);
    driver.resume();
    await vi.waitFor(() => {
      const progress = driver.getProgress();
      expect(progress.stage === "complete" || progress.failure !== undefined).toBe(true);
    });

    expect(driver.getProgress().stage).toBe("complete");
    expect(gateway.signRequests.filter(isDeposit)).toEqual([]);
  });
});

describe("createPredictRun's steps once settled", () => {
  const hashOf = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;

  it("carry the hash each confirmed under, and none where a step was skipped", async () => {
    const { progress } = await runToEndWith(
      snapshot({ deposit: WAD * 3n, collateralIn: WAD * 5n, collateralBefore: WAD * 2n }),
      fakeReader({ deployed: true, collateral: WAD * 5n }),
    );

    expect(progress.stage).toBe("complete");
    expect(progress.steps.map(({ id, hash }) => ({ id, hash }))).toEqual([
      { id: STEP_ID.createExecutor, hash: undefined },
      { id: STEP_ID.deposit, hash: hashOf(1) },
      { id: STEP_ID.predict(1), hash: hashOf(2) },
    ]);
    expect(progress.steps[0]).not.toHaveProperty("hash");
  });

  it("keep a recovered step's stored hash, and give none to a step that landed before its hash was kept", async () => {
    const snap = snapshot({ deposit: WAD * 3n, collateralIn: WAD * 5n, collateralBefore: WAD * 2n });
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const flowId = "predict-receipt-recovered";
    const created = `0x${"a".repeat(64)}` as Hash;
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
          outcome: { status: "confirmed", hash: created, blockNumber: 1n },
        },
        { stepId: STEP_ID.deposit, label: "Add money to your trade wallet", outcome: { status: "awaiting-signature" } },
        { stepId: STEP_ID.predict(1), label: "Making your prediction", outcome: { status: "pending" } },
      ],
    });
    const deposit = depositTx({
      executor: addresses.executor,
      asset: { token: addresses.collateral, amount: WAD * 3n },
    });
    const driver = createPredictRun({
      gateway: fakeGateway(),
      reader: fakeReader({ deployed: true, collateral: WAD * 5n, landed: [landedTx(deposit)] }),
      quoter: fakeQuoter(),
      flowId,
      store,
      ctx: () => ctx(),
      snapshot: () => snap,
    });
    drivers.push(driver);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("review"));
    driver.resume();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));

    expect(driver.getProgress().steps.map(({ id, hash }) => ({ id, hash }))).toEqual([
      { id: STEP_ID.createExecutor, hash: created },
      { id: STEP_ID.deposit, hash: undefined },
      { id: STEP_ID.predict(1), hash: hashOf(1) },
    ]);
  });
});

describe("createPredictRun holding another wallet's saved run", () => {
  it("keeps the run in storage when the halted popup is reset", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const flowId = "predict-other-owner";
    store.save<PredictSnapshot, ReturnType<typeof ctx>>({
      flowId,
      adapterId: "predict-flow",
      snapshot: snapshot(),
      ctx: ctx(),
      status: "paused",
      reason: "rejected",
      steps: [{ stepId: STEP_ID.predict(1), label: "Making your prediction", outcome: { status: "pending" } }],
    });
    const gateway = fakeGateway();
    const driver = createPredictRun({
      gateway,
      reader: fakeReader({ deployed: true }),
      quoter: fakeQuoter(),
      flowId,
      store,
      ctx: () => ctx({ owner: `0x${"b".repeat(40)}` }),
      snapshot: () => snapshot(),
    });
    drivers.push(driver);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("wrong-wallet"));
    driver.reset();

    expect(store.load(flowId)?.ctx).toEqual(ctx());
    expect(gateway.signRequests).toEqual([]);
  });
});

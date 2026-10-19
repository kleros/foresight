import { createFlowRunStore, createMemoryStorage, type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import type { Hash, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addresses,
  chainState,
  ctx,
  fakeCreditsQuoter,
  fakeQuoter,
  fakeReader,
  option,
  snapshot,
  WAD,
} from "../../flow/__tests__/support/fakes";
import { optionsPerBatch, previewCreditsSwap } from "../../flow/plan";
import type { PredictCtx, PredictSlippage, PredictSnapshot } from "../../flow/types";
import { CREDITS_SLIPPAGE_BPS, SLIPPAGE_BPS } from "../../oracle/tolerances";
import { previewTrades, type PreviewTrades } from "../../utils/plan";
import { createPredictRun } from "../driver";
import type { PredictDriver } from "../types";

const OPTION = option(1);
const KEY = OPTION.childMarket.toLowerCase();
const STATE = chainState();
const CREDITS = 2n * WAD;
const AUTO: PredictSlippage = { tradeBps: SLIPPAGE_BPS, creditsBps: CREDITS_SLIPPAGE_BPS };

const planOn = (split: bigint, slippageBps: number): PreviewTrades =>
  previewTrades(
    {
      pools: STATE.pools,
      targetPriceWad: OPTION.targetPriceWad,
      held: STATE.held,
      splitAmount: STATE.underlying + split,
    },
    slippageBps,
  )!;

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

/**
 * Every send lands but executor batch `revertNth`, which reverts; once batch 1 lands the chain holds its split.
 * `settings` is what the popup's settings say now.
 */
function setup(
  request: PredictSnapshot,
  opts: { revertNth?: number; store?: ReturnType<typeof createFlowRunStore>; blockGasLimit?: bigint } = {},
) {
  const revertNth = opts.revertNth ?? 1;
  let split = false;
  let settings = request.slippage;
  const sent: FlowTx[] = [];
  const reverted = new Set<Hash>();
  const receipt = (hash: Hash) =>
    ({
      transactionHash: hash,
      status: reverted.has(hash) ? "reverted" : "success",
      blockNumber: 2n,
      logs: [],
    }) as unknown as TransactionReceipt;
  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      sent.push(tx);
      const hash = `0x${sent.length.toString(16).padStart(64, "0")}` as Hash;
      if (tx.to === addresses.executor) {
        const nth = sent.filter((each) => each.to === addresses.executor).length;
        if (nth === revertNth) reverted.add(hash);
        else if (nth === 1) split = true;
      }
      return Promise.resolve(hash);
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
    getReceipt: (hash) => Promise.resolve(receipt(hash)),
    isKnown: () => Promise.resolve(true),
  };
  const reader = fakeReader({
    deployed: true,
    blockGasLimit: opts.blockGasLimit,
    state: () => (split ? chainState({ underlying: STATE.underlying + request.collateralIn }) : STATE),
    credits: { [addresses.executor]: request.creditsToSpend },
  });
  const creditsQuoter = fakeCreditsQuoter({});
  const driver = createPredictRun({
    gateway,
    reader,
    quoter: fakeQuoter(),
    creditsQuoter,
    flowId: `retry-slippage-${drivers.length}`,
    store: opts.store,
    ctx: () => ctx(),
    snapshot: () => ({ ...request, slippage: settings }),
    slippage: () => settings,
  });
  drivers.push(driver);
  const preview = (creditsBps: number) =>
    previewCreditsSwap(ctx(), request.creditsToSpend, creditsBps, { reader, creditsQuoter });
  return { driver, sent, preview, setSettings: (next: PredictSlippage) => (settings = next) };
}

const stageIs = (driver: PredictDriver, stage: string) =>
  vi.waitFor(() => expect(driver.getProgress().stage).toBe(stage));

const sdaiRun = snapshot({ options: [OPTION], deposit: WAD, collateralIn: WAD, slippage: AUTO });
const creditsRun = snapshot({
  options: [OPTION],
  deposit: 0n,
  collateralIn: 0n,
  creditsToSpend: CREDITS,
  slippage: AUTO,
});

describe("a retry after the slippage settings changed", () => {
  it("re-plans the reverted batch at the new trade slippage and stops at moved before signing it", async () => {
    const { driver, sent, setSettings } = setup(sdaiRun);
    driver.start({ plans: { [KEY]: planOn(WAD, SLIPPAGE_BPS) } });
    await stageIs(driver, "halted");
    expect(driver.getProgress().failure?.reason).toBe("reverted");
    const signed = sent.length;

    setSettings({ ...AUTO, tradeBps: 1_000 });
    driver.retry();
    await stageIs(driver, "moved");

    expect(driver.getProgress().moved?.plans[KEY]).toEqual(planOn(WAD, 1_000));
    expect(sent).toHaveLength(signed);

    driver.confirm();
    await stageIs(driver, "complete");
    expect(sent).toHaveLength(signed + 1);
  });

  it("retries straight on with the settings unchanged", async () => {
    const { driver, sent } = setup(sdaiRun);
    driver.start({ plans: { [KEY]: planOn(WAD, SLIPPAGE_BPS) } });
    await stageIs(driver, "halted");
    const signed = sent.length;

    driver.retry();
    await stageIs(driver, "complete");

    expect(sent).toHaveLength(signed + 1);
  });

  it("quotes the credits swap again at the new credits slippage and stops at moved", async () => {
    const { driver, sent, preview, setSettings } = setup(creditsRun);
    const shown = await preview(CREDITS_SLIPPAGE_BPS);
    driver.start({ plans: { [KEY]: planOn(shown.minted, SLIPPAGE_BPS) }, credits: shown });
    await stageIs(driver, "halted");
    const signed = sent.length;

    setSettings({ ...AUTO, creditsBps: 100 });
    driver.retry();
    await stageIs(driver, "moved");

    expect(driver.getProgress().moved?.credits).toEqual(await preview(100));
    expect(sent).toHaveLength(signed);
  });
});

/** The smallest block gas limit whose batches hold one option each, without a credits leg. */
function onePerBatch(): bigint {
  for (let gas = 1_000_000n; gas < 100_000_000n; gas += 100_000n) if (optionsPerBatch(gas, false) === 1) return gas;
  throw new Error("No gas limit gives one option per batch.");
}

describe("a retry's new slippage before the visitor confirms it", () => {
  it("leaves the stored run at the confirmed slippage while the run waits at moved", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const { driver, setSettings } = setup(sdaiRun, { store });
    driver.start({ plans: { [KEY]: planOn(WAD, SLIPPAGE_BPS) } });
    await stageIs(driver, "halted");

    setSettings({ ...AUTO, tradeBps: 5_000 });
    driver.retry();
    await stageIs(driver, "moved");
    driver.dispose();

    expect(store.load<PredictSnapshot, PredictCtx>("retry-slippage-0")?.snapshot.slippage).toEqual(AUTO);
  });

  it("stores the new slippage once the visitor confirms it", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const { driver, setSettings } = setup(sdaiRun, { store });
    driver.start({ plans: { [KEY]: planOn(WAD, SLIPPAGE_BPS) } });
    await stageIs(driver, "halted");

    setSettings({ ...AUTO, tradeBps: 5_000 });
    driver.retry();
    await stageIs(driver, "moved");
    expect(driver.getProgress().moved?.bySlippage).toBe(true);
    driver.confirm();
    await vi.waitFor(() =>
      expect(store.load<PredictSnapshot, PredictCtx>("retry-slippage-0")?.snapshot.slippage.tradeBps).toBe(5_000),
    );
  });

  it("re-plans every batch still to land, so a partly landed run stops at moved once", async () => {
    const options = [option(1), option(2), option(3)];
    const request = snapshot({ options, deposit: WAD, collateralIn: WAD, slippage: AUTO });
    const { driver, sent, setSettings } = setup(request, { revertNth: 2, blockGasLimit: onePerBatch() });
    const plans = Object.fromEntries(
      options.map((each) => [each.childMarket.toLowerCase(), planOn(WAD, SLIPPAGE_BPS)]),
    );
    driver.start({ plans });
    await stageIs(driver, "halted");
    expect(driver.getProgress().batchesDone).toBe(1);

    setSettings({ ...AUTO, tradeBps: 1_000 });
    driver.retry();
    await stageIs(driver, "moved");
    expect(driver.getProgress().moved?.markets).toHaveLength(2);
    const signed = sent.length;

    driver.confirm();
    await vi.waitFor(() => expect(["complete", "moved"]).toContain(driver.getProgress().stage));
    expect(driver.getProgress().stage).toBe("complete");
    expect(sent).toHaveLength(signed + 2);
  });
});

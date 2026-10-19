import { type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import { decodeFunctionData, type Hash, type TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ALGEBRA_ROUTER_ABI } from "@/lib/swap/algebraRouter";

import { creditsManagerAbi, gnosisRouterAbi, tradeExecutorAbi } from "@/config/contracts";

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
import { previewCreditsSwap } from "../../flow/plan";
import type { CreditsSwapPreview, OptionChainState, PredictSnapshot } from "../../flow/types";
import { CREDITS_SLIPPAGE_BPS, SLIPPAGE_BPS } from "../../oracle/tolerances";
import { previewTrades, type PreviewTrades } from "../../utils/plan";
import { createPredictRun } from "../driver";
import type { PredictDriver } from "../types";

const OPTION = option(1);
const KEY = OPTION.childMarket.toLowerCase();
const CREDITS = 2n * WAD;

/** The fakes' pools: UP shallow above the estimate, DOWN deep below it. */
const AS_SHOWN = chainState();
/** UP four times as deep, so selling it to the estimate takes far more than was shown. */
const DEEPER = chainState({ pools: { ...AS_SHOWN.pools, up: { ...AS_SHOWN.pools.up, liquidity: 2n * WAD } } });
/** UP 30% deeper: within a 50% slippage setting, well past the moved tolerance. */
const SLIGHTLY_DEEPER = chainState({
  pools: { ...AS_SHOWN.pools, up: { ...AS_SHOWN.pools.up, liquidity: (13n * WAD) / 20n } },
});

/** The plan the popup shows for `state` with `split` minted per option, as `usePricePreview` works it out. */
const planOn = (state: OptionChainState, split: bigint, slippageBps = SLIPPAGE_BPS): PreviewTrades =>
  previewTrades(
    {
      pools: state.pools,
      targetPriceWad: OPTION.targetPriceWad,
      held: state.held,
      splitAmount: state.underlying + split,
    },
    slippageBps,
  )!;

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

/** A chain where every send lands; `onSend` lets a test move the pools while a transaction is out. */
function setup(args: {
  request: PredictSnapshot;
  state: OptionChainState;
  creditsLossBps?: () => bigint;
  onSend?: (tx: FlowTx, moveTo: (next: OptionChainState) => void) => void;
}) {
  let state = args.state;
  const moveTo = (next: OptionChainState) => (state = next);
  const sent: FlowTx[] = [];
  const receipt = (hash: Hash) =>
    ({ transactionHash: hash, status: "success", blockNumber: 2n, logs: [] }) as unknown as TransactionReceipt;
  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      sent.push(tx);
      args.onSend?.(tx, moveTo);
      return Promise.resolve(`0x${sent.length.toString(16).padStart(64, "0")}` as Hash);
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
    getReceipt: (hash) => Promise.resolve(receipt(hash)),
    isKnown: () => Promise.resolve(true),
  };
  const reader = fakeReader({
    deployed: true,
    state: () => state,
    credits: { [addresses.executor]: args.request.creditsToSpend },
  });
  const creditsQuoter = fakeCreditsQuoter({ lossBps: args.creditsLossBps });
  const driver = createPredictRun({
    gateway,
    reader,
    quoter: fakeQuoter(),
    creditsQuoter,
    flowId: `held-${drivers.length}`,
    ctx: () => ctx(),
    snapshot: () => args.request,
  });
  drivers.push(driver);
  const preview = (): Promise<CreditsSwapPreview> =>
    previewCreditsSwap(ctx(), args.request.creditsToSpend, args.request.slippage.creditsBps, {
      reader,
      creditsQuoter,
    });
  return { driver, sent, moveTo, preview };
}

function batchCalls(tx: FlowTx) {
  if (tx.to !== addresses.executor || !tx.data) return [];
  const decoded = decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data });
  if (decoded.functionName !== "batchValueExecute" && decoded.functionName !== "batchExecute") return [];
  return decoded.args[0].map((call) => ({ to: call.to, data: call.data }));
}

/** What a batch splits of the option's underlying. */
function optionSplit(tx: FlowTx): bigint | undefined {
  for (const call of batchCalls(tx)) {
    if (call.to !== addresses.router) continue;
    const decoded = decodeFunctionData({ abi: gnosisRouterAbi, data: call.data });
    if (decoded.functionName === "splitPosition" && decoded.args[1] === OPTION.childMarket) return decoded.args[2];
  }
  return undefined;
}

/** The least the credits swap in a batch may pay. */
function creditsMinimum(tx: FlowTx): bigint | undefined {
  for (const call of batchCalls(tx)) {
    if (call.to !== addresses.manager) continue;
    const execute = decodeFunctionData({ abi: creditsManagerAbi, data: call.data });
    if (execute.functionName !== "execute") continue;
    const swap = decodeFunctionData({ abi: ALGEBRA_ROUTER_ABI, data: execute.args[1] });
    return swap.args[0].amountOutMinimum;
  }
  return undefined;
}

const sdaiRun = snapshot({ options: [OPTION], deposit: WAD, collateralIn: WAD });
const creditsRun = snapshot({ options: [OPTION], deposit: 0n, collateralIn: 0n, creditsToSpend: CREDITS });

const complete = (driver: PredictDriver) => vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));
const atMoved = (driver: PredictDriver) => vi.waitFor(() => expect(driver.getProgress().stage).toBe("moved"));

describe("a run held to what Details showed", () => {
  it("signs the per-option split Details showed when the credits swap loses 30%", async () => {
    const { driver, sent, preview } = setup({ request: creditsRun, state: AS_SHOWN, creditsLossBps: () => 3000n });
    const credits = await preview();

    driver.start({ plans: { [KEY]: planOn(AS_SHOWN, credits.minted) }, credits });
    await complete(driver);

    expect(optionSplit(sent.at(-1)!)).toBe(planOn(AS_SHOWN, credits.minted).split);
  });

  it("holds the credits swap's minimum to the floor Details showed", async () => {
    let loss = 5n;
    const { driver, sent, preview } = setup({ request: creditsRun, state: AS_SHOWN, creditsLossBps: () => loss });
    const credits = await preview();
    loss = 10n;

    driver.start({ plans: { [KEY]: planOn(AS_SHOWN, credits.minted) }, credits });
    await complete(driver);

    expect(creditsMinimum(sent.at(-1)!)).toBe(credits.floor);
  });

  it("stops at moved, signing nothing, when the credits swap now pays less than the floor Details showed", async () => {
    let loss = 5n;
    const { driver, sent, preview } = setup({ request: creditsRun, state: AS_SHOWN, creditsLossBps: () => loss });
    const credits = await preview();
    loss = 3000n;

    driver.start({ plans: { [KEY]: planOn(AS_SHOWN, credits.minted) }, credits });
    await atMoved(driver);

    const now = await preview();
    expect(driver.getProgress().moved?.credits).toEqual(now);
    expect(driver.getProgress().moved?.plans[KEY]).toEqual(planOn(AS_SHOWN, now.minted));
    expect(sent).toEqual([]);

    driver.confirm();
    await complete(driver);
    expect(creditsMinimum(sent.at(-1)!)).toBe(now.floor);
  });

  it("stops at moved when a run spends credits Details showed no swap for", async () => {
    const { driver, sent, preview } = setup({ request: creditsRun, state: AS_SHOWN });
    const credits = await preview();

    driver.start({ plans: { [KEY]: planOn(AS_SHOWN, credits.minted) } });
    await atMoved(driver);

    expect(driver.getProgress().moved?.credits).toEqual(credits);
    expect(sent).toEqual([]);
  });

  it("stops at moved when an option Details showed no plan for now trades", async () => {
    const { driver, sent } = setup({ request: sdaiRun, state: AS_SHOWN });

    driver.start({ plans: {} });
    await atMoved(driver);

    expect(driver.getProgress().moved).toEqual({
      markets: [OPTION.childMarket],
      plans: { [KEY]: planOn(AS_SHOWN, WAD) },
    });
    expect(sent).toEqual([]);
  });

  it("stops at moved under a 50% slippage setting when the plan's amounts moved by a third", async () => {
    const request = { ...sdaiRun, slippage: { tradeBps: 5_000, creditsBps: CREDITS_SLIPPAGE_BPS } };
    const { driver, sent } = setup({ request, state: SLIGHTLY_DEEPER });

    driver.start({ plans: { [KEY]: planOn(AS_SHOWN, WAD, 5_000) } });
    await atMoved(driver);

    expect(sent).toEqual([]);
  });

  it("stops at moved rather than re-plan when the pools move while the deposit is signed, then goes on once confirmed", async () => {
    const { driver, sent } = setup({
      request: sdaiRun,
      state: AS_SHOWN,
      onSend: (tx, moveTo) => {
        if (tx.to !== addresses.executor) moveTo(DEEPER);
      },
    });

    driver.start({ plans: { [KEY]: planOn(AS_SHOWN, WAD) } });
    await atMoved(driver);

    expect(sent.map((tx) => tx.to)).toEqual([addresses.collateral]);
    expect(driver.getProgress().moved).toEqual({
      markets: [OPTION.childMarket],
      plans: { [KEY]: planOn(DEEPER, WAD) },
    });
    expect(driver.getProgress().failure).toBeUndefined();

    driver.confirm();
    await complete(driver);
    expect(sent.map((tx) => tx.to)).toEqual([addresses.collateral, addresses.executor]);
  });
});

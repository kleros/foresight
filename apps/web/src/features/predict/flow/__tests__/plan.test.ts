import { decodeFunctionData, erc20Abi, type Address, type Hex, type TransactionReceipt } from "viem";
import { describe, expect, it } from "vitest";

import { lensQuoterOn, nodeAnswers } from "@/lib/swap/__tests__/support/lensNode";

import { gnosisRouterAbi, tradeExecutorAbi } from "@/config/contracts";

import { LEG_HEADROOM_BPS } from "../../utils/plan";
import {
  createPredictHooks,
  PREDICT_BATCH_SIZE,
  planPredict,
  QuoteFailedError,
  STEP_ID,
  TxPendingError,
  type PredictDeps,
} from "../plan";
import type { LandedTx, PredictOption, PredictSnapshot } from "../types";
import {
  addresses,
  AT,
  chainState,
  ctx,
  DEEP,
  fakeQuoter,
  fakeReader,
  landedTx,
  mintLog,
  option,
  quoterFor,
  snapshot,
  WAD,
} from "./support/fakes";

const deps = (overrides: Partial<PredictDeps> = {}): PredictDeps => ({
  reader: fakeReader(),
  quoter: fakeQuoter(),
  ...overrides,
});

/** The calls a `batchExecute` carries. */
function innerCalls(data: Hex): readonly { to: Address; data: Hex }[] {
  const decoded = decodeFunctionData({ abi: tradeExecutorAbi, data });
  if (decoded.functionName !== "batchExecute") throw new Error(`Expected batchExecute, got ${decoded.functionName}`);

  return decoded.args[0];
}

/** Each of them as `<target>:<function>`, so a test can read the batch as a sequence. */
function batchShape(data: Hex): string[] {
  return innerCalls(data).map((call) => {
    if (call.to === addresses.swapRouter) return `${call.to}:swap`;
    const abi = call.data.startsWith("0x095ea7b3") ? erc20Abi : gnosisRouterAbi;
    return `${call.to}:${decodeFunctionData({ abi, data: call.data }).functionName}`;
  });
}

describe("planPredict", () => {
  it("sets up the wallet, adds the money, then predicts", () => {
    const steps = planPredict(snapshot(), deps());

    expect(steps.map((step) => step.id)).toEqual([STEP_ID.createExecutor, STEP_ID.deposit, STEP_ID.predict(1)]);
  });

  it("leaves out the deposit when the visitor is spending what is already there", () => {
    const steps = planPredict(snapshot({ deposit: 0n, collateralIn: 0n }), deps());

    expect(steps.map((step) => step.id)).toEqual([STEP_ID.createExecutor, STEP_ID.predict(1)]);
  });

  it("refuses a run with no estimates on it", () => {
    expect(() => planPredict(snapshot({ options: [] }), deps())).toThrow(/no estimates/i);
  });

  it("asks the chain whether the wallet already exists rather than assuming", async () => {
    const steps = planPredict(snapshot(), deps({ reader: fakeReader({ deployed: true }) }));
    const create = steps.find((step) => step.id === STEP_ID.createExecutor)!;

    await expect(create.canSkip!(ctx(), snapshot())).resolves.toBe(true);
  });

  it("gives each batch of options its own transaction", () => {
    const options = Array.from({ length: 5 }, (_, index) => option(index + 1));

    const steps = planPredict(snapshot({ options }), deps({ optionsPerBatch: 2 }));

    expect(steps.map((step) => step.id)).toEqual([
      STEP_ID.createExecutor,
      STEP_ID.deposit,
      STEP_ID.predict(1),
      STEP_ID.predict(2),
      STEP_ID.predict(3),
    ]);
  });

  it("puts every option in one transaction up to the batch size", () => {
    const options = Array.from({ length: PREDICT_BATCH_SIZE }, (_, index) => option(index + 1));

    const steps = planPredict(snapshot({ options }), deps());

    expect(steps.filter((step) => step.id.startsWith("predict-"))).toHaveLength(1);
  });
});

describe("the predict step", () => {
  const buildPredict = async (
    snap = snapshot(),
    overrides: Partial<PredictDeps> = {},
    batch = 1,
    optionsPerBatch?: number,
  ) => {
    const resolved = deps({ ...overrides, ...(optionsPerBatch === undefined ? {} : { optionsPerBatch }) });
    const steps = planPredict(snap, resolved);
    const step = steps.find((each) => each.id === STEP_ID.predict(batch))!;
    return { tx: await step.build(ctx(), snap), deps: resolved };
  };

  it("splits the collateral, sells, merges the pairs left over, then buys", async () => {
    const one = option(1);
    const { tx } = await buildPredict();

    expect(batchShape(tx.data!)).toEqual([
      `${addresses.collateral}:approve`,
      `${addresses.router}:splitPosition`,
      `${one.underlying}:approve`,
      `${addresses.router}:splitPosition`,
      `${one.upToken}:approve`,
      `${addresses.swapRouter}:swap`,
      `${one.upToken}:approve`,
      `${one.downToken}:approve`,
      `${one.upToken}:approve`,
      `${one.invalidToken}:approve`,
      `${addresses.router}:mergePositions`,
      `${one.underlying}:approve`,
      `${addresses.swapRouter}:swap`,
      `${one.underlying}:approve`,
    ]);
  });

  it("splits only what the visitor put in, at the session's parent", async () => {
    const { tx } = await buildPredict(snapshot({ collateralIn: WAD * 3n }));
    const calls = innerCalls(tx.data!);

    expect(decodeFunctionData({ abi: gnosisRouterAbi, data: calls[1]!.data }).args).toEqual([
      addresses.collateral,
      addresses.parentMarket,
      WAD * 3n,
    ]);
  });

  it("splits collateral once, in the first batch only", async () => {
    const options = [option(1), option(2)];
    // the first batch's parent split already gave every option its underlying
    const reader = fakeReader({ state: () => chainState({ underlying: WAD }) });

    const { tx } = await buildPredict(snapshot({ options }), { reader }, 2, 1);

    expect(batchShape(tx.data!).filter((call) => call.endsWith(":splitPosition"))).toEqual([
      `${addresses.router}:splitPosition`,
    ]);
  });

  it("quotes the sell before it sizes the buy, since the sell is what pays for it", async () => {
    const { deps: used } = await buildPredict();
    const quoter = used.quoter as ReturnType<typeof fakeQuoter>;
    const one = option(1);

    expect(quoter.requests.map((request) => [request.tokenIn, request.tokenOut])).toEqual([
      [one.upToken, one.underlying],
      [one.underlying, one.downToken],
    ]);
  });

  it("quotes with the executor as the recipient, never the owner", async () => {
    const { deps: used } = await buildPredict();
    const quoter = used.quoter as ReturnType<typeof fakeQuoter>;

    expect(quoter.requests.every((request) => request.recipient === addresses.executor)).toBe(true);
  });

  it("reads the chain for only the options in its own batch", async () => {
    const options = [option(1), option(2)];
    const reader = fakeReader({ state: () => chainState({ underlying: WAD }) });

    await buildPredict(snapshot({ options }), { reader }, 2, 1);

    expect(reader.asked.at(-1)!.options.map((each) => each.childMarket)).toEqual([options[1]!.childMarket]);
  });

  it("leaves out an option nothing will route, and says which", async () => {
    const options = [option(1), option(2)];
    const skipped: PredictOption[] = [];
    const refuse = (request: { tokenIn: Address }) =>
      request.tokenIn === options[0]!.upToken || request.tokenIn === options[0]!.underlying;

    const { tx } = await buildPredict(snapshot({ options }), {
      quoter: fakeQuoter({ refuse }),
      onSkip: (each) => skipped.push(each),
    });

    expect(skipped.map((each) => each.childMarket)).toEqual([options[0]!.childMarket]);
    expect(batchShape(tx.data!).some((call) => call.startsWith(options[1]!.underlying))).toBe(true);
  });

  it("refuses the batch, leaving no option out, when one option's quote cannot be had", async () => {
    const options = [option(1), option(2)];
    const skipped: PredictOption[] = [];
    const quoter = quoterFor(options[0]!, lensQuoterOn(nodeAnswers.unreachable), fakeQuoter());

    await expect(
      buildPredict(snapshot({ options }), { quoter, onSkip: (each) => skipped.push(each) }),
    ).rejects.toBeInstanceOf(QuoteFailedError);
    expect(skipped).toEqual([]);
  });

  it("sizes the buy from what the sell was quoted to pay, not from the merge alone", async () => {
    const { deps: used } = await buildPredict();
    const quoter = used.quoter as ReturnType<typeof fakeQuoter>;

    // the sell offers 0.5 of UP plus headroom, quoted at half that, and the rest of the pairs merge back
    const sold = ((WAD / 2n) * (10_000n + LEG_HEADROOM_BPS)) / 10_000n;
    expect(quoter.requests[1]!.amount).toBe(((sold / 2n + WAD - sold) * 98n) / 100n);
    expect(quoter.requests.map((request) => request.slippageBps)).toEqual([100, 100]);
  });

  it("quotes and sizes the buy with the same slippage setting", async () => {
    const { deps: used } = await buildPredict(snapshot(), { slippageBps: 300 });
    const quoter = used.quoter as ReturnType<typeof fakeQuoter>;

    const sold = ((WAD / 2n) * (10_000n + LEG_HEADROOM_BPS)) / 10_000n;
    expect(quoter.requests[1]!.amount).toBe(((sold / 2n + WAD - sold) * 96n) / 100n);
    expect(quoter.requests.map((request) => request.slippageBps)).toEqual([300, 300]);
  });

  it("leaves out an option the market already agrees with", async () => {
    const skipped: PredictOption[] = [];
    // UP sits exactly where the estimate puts it, and DOWN's pool never priced
    const reader = fakeReader({
      state: () =>
        chainState({
          pools: {
            up: { sqrtPriceX96: AT["0.25"], liquidity: DEEP, tick: 0, fee: 0n, ticks: [], outcomeIsToken0: true },
            down: { sqrtPriceX96: 0n, liquidity: 0n, tick: 0, fee: 0n, ticks: [], outcomeIsToken0: true },
          },
        }),
    });

    await expect(buildPredict(snapshot(), { reader, onSkip: (each) => skipped.push(each) })).rejects.toThrow(
      /no route/i,
    );
    expect(skipped).toHaveLength(1);
  });

  it("refuses the batch when nothing in it will route", async () => {
    await expect(buildPredict(snapshot(), { quoter: fakeQuoter({ refuse: () => true }) })).rejects.toThrow(/no route/i);
  });

  it("splits the underlying the executor already holds, not only what was deposited", async () => {
    const { tx } = await buildPredict(snapshot({ collateralIn: WAD, deposit: WAD }), {
      reader: fakeReader({ state: () => chainState({ underlying: WAD * 2n }) }),
    });
    const calls = innerCalls(tx.data!);

    // the child split takes the 2 already held plus the 1 the parent split is about to mint,
    // and approves the parent's outcome token while naming the session's collateral
    expect(calls[2]!.to).toBe(option(1).underlying);
    expect(decodeFunctionData({ abi: gnosisRouterAbi, data: calls[3]!.data }).args).toEqual([
      addresses.collateral,
      option(1).childMarket,
      WAD * 3n,
    ]);
  });
});

describe("the deposit step", () => {
  const depositStep = (snap = snapshot()) => planPredict(snap, deps()).find((step) => step.id === STEP_ID.deposit)!;

  it("transfers the collateral itself by default", async () => {
    const tx = await depositStep().build(ctx(), snapshot());

    expect(tx.to).toBe(addresses.collateral);
    expect(decodeFunctionData({ abi: erc20Abi, data: tx.data! }).args).toEqual([addresses.executor, WAD]);
  });

  it("routes xDAI through the savings adapter", async () => {
    const snap = snapshot({ depositNative: true });
    const tx = await depositStep(snap).build(ctx(), snap);

    expect(tx.to).toBe(addresses.sDaiAdapter);
    expect(tx.value).toBe(WAD);
  });

  it("refuses xDAI on a chain with no adapter", async () => {
    const snap = snapshot({ depositNative: true });

    await expect(async () => depositStep(snap).build(ctx({ sDaiAdapter: null }), snap)).rejects.toThrow(/xDAI/);
  });
});

describe("skipping a step that has already landed", () => {
  const step = (id: string, snap: PredictSnapshot, landed: LandedTx[], pending = false) =>
    planPredict(snap, deps({ reader: fakeReader({ landed, pending: () => pending }) })).find((each) => each.id === id)!;

  it.each([
    ["an sDAI deposit", snapshot({ deposit: WAD * 4n, collateralAtStart: WAD * 6n })],
    ["an xDAI deposit", snapshot({ deposit: WAD * 5n, depositNative: true, collateralAtStart: WAD * 6n })],
  ])("skips %s once its own transaction has landed, and not on money that arrived some other way", async (_, snap) => {
    const deposit = await step(STEP_ID.deposit, snap, []).build(ctx(), snap);
    const another = { ...deposit, value: (deposit.value ?? 0n) + 1n };

    await expect(step(STEP_ID.deposit, snap, [landedTx(deposit)]).canSkip!(ctx(), snap)).resolves.toBe(true);
    await expect(step(STEP_ID.deposit, snap, [landedTx(another)]).canSkip!(ctx(), snap)).resolves.toBe(false);
    await expect(step(STEP_ID.deposit, snap, []).canSkip!(ctx(), snap)).resolves.toBe(false);
    await expect(step(STEP_ID.deposit, snap, [], true).canSkip!(ctx(), snap)).rejects.toBeInstanceOf(TxPendingError);
  });

  it("skips an sDAI run's first batch once a batch splitting its amount at its parent landed", async () => {
    const snap = snapshot({ deposit: 0n, collateralIn: WAD * 2n, collateralBefore: WAD * 10n });
    const batch = await step(STEP_ID.predict(1), snap, []).build(ctx(), snap);
    const other = await step(STEP_ID.predict(1), snap, []).build(ctx(), { ...snap, collateralIn: WAD });

    await expect(step(STEP_ID.predict(1), snap, [landedTx(batch)]).canSkip!(ctx(), snap)).resolves.toBe(true);
    await expect(step(STEP_ID.predict(1), snap, [landedTx(other)]).canSkip!(ctx(), snap)).resolves.toBe(false);
    await expect(step(STEP_ID.predict(1), snap, [], true).canSkip!(ctx(), snap)).rejects.toBeInstanceOf(TxPendingError);
  });
});

describe("createPredictHooks", () => {
  const deposited = {
    stepId: STEP_ID.deposit,
    label: "Add money",
    outcome: { status: "confirmed" as const, hash: "0x1" as const, blockNumber: 1n },
  };
  const receipt = (minted: bigint) => ({ logs: [mintLog(minted)] }) as unknown as TransactionReceipt;

  it("splits what an xDAI deposit's receipt shows it minted, not the trade wallet's balance", async () => {
    const hooks = createPredictHooks({ reader: fakeReader({ collateral: WAD * 70n }) });

    const result = await hooks.afterStep!({
      ctx: ctx(),
      snapshot: snapshot({ depositNative: true }),
      completed: deposited,
      receipt: receipt(WAD * 7n),
      pending: [],
    });

    expect(result).toEqual({ snapshotPatch: { collateralIn: WAD * 7n } });
  });

  it.each([
    ["the cache 2 below the chain", WAD * 3n, WAD * 9n, WAD * 6n, WAD * 9n],
    ["the cache at 0", 0n, WAD * 10n, WAD * 10n, WAD * 10n],
  ])(
    "splits what an xDAI deposit minted plus the trade-wallet share shown (%s)",
    async (_, shown, estimate, minted, expected) => {
      const hooks = createPredictHooks({ reader: fakeReader() });

      const result = await hooks.afterStep!({
        ctx: ctx(),
        snapshot: snapshot({ depositNative: true, collateralIn: estimate, collateralBefore: shown }),
        completed: deposited,
        receipt: receipt(minted),
        pending: [],
      });

      expect(result).toEqual({ snapshotPatch: { collateralIn: expected } });
    },
  );

  it("reads a skipped xDAI deposit's mint from its own landed transaction", async () => {
    const snap = snapshot({ depositNative: true, deposit: WAD * 5n });
    const deposit = await planPredict(snap, deps())
      .find((each) => each.id === STEP_ID.deposit)!
      .build(ctx(), snap);
    const hooks = createPredictHooks({ reader: fakeReader({ landed: [landedTx(deposit, WAD * 4n)] }) });

    const result = await hooks.afterStep!({
      ctx: ctx(),
      snapshot: snap,
      completed: { stepId: STEP_ID.deposit, label: "Add money", outcome: { status: "skipped" } },
      receipt: null,
      pending: [],
    });

    expect(result).toEqual({ snapshotPatch: { collateralIn: WAD * 4n } });
  });

  it("takes a collateral deposit at the amount that was asked for", async () => {
    const hooks = createPredictHooks({ reader: fakeReader({ collateral: WAD * 7n }) });

    const result = await hooks.afterStep!({
      ctx: ctx(),
      snapshot: snapshot(),
      completed: deposited,
      receipt: null,
      pending: [],
    });

    expect(result).toBeUndefined();
  });
});

import { decodeFunctionData, erc20Abi, parseAbi, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { gnosisRouterAbi, tradeExecutorAbi } from "@/config/contracts";

import { CREDITS_MAX_LOSS_BPS, CREDITS_SLIPPAGE_BPS } from "../../oracle/tolerances";
import {
  assertRoutes,
  CreditsUnavailableError,
  planPredict,
  PredictConfigError,
  STEP_ID,
  type PredictDeps,
} from "../plan";
import type { PredictCtx, PredictSnapshot } from "../types";
import { departures, resolvedFrom } from "./support/allowed";
import {
  addresses,
  ALGEBRA_ROUTER_ABI,
  chainState,
  ctx,
  fakeCreditsQuoter,
  fakeQuoter,
  fakeReader,
  option,
  snapshot,
  VAULT_RATE,
  WAD,
} from "./support/fakes";

const WXDAI_ABI = parseAbi(["function withdraw(uint256 wad)"]);
const EXECUTE_ABI = parseAbi(["function execute(address to, bytes data, uint256 amount, address outputToken)"]);

/** 2 credits spent, 1.5 of them moved from the wallet, with 3 sDAI split beside them. */
const creditsRun = (overrides: Partial<PredictSnapshot> = {}): PredictSnapshot =>
  snapshot({
    deposit: 3n * WAD,
    collateralIn: 3n * WAD,
    creditsFromEoa: (3n * WAD) / 2n,
    creditsToSpend: 2n * WAD,
    creditsAtStart: WAD / 2n,
    ...overrides,
  });

const deps = (overrides: Partial<PredictDeps> = {}): PredictDeps => ({
  reader: fakeReader({ credits: { [addresses.executor]: 2n * WAD } }),
  quoter: fakeQuoter(),
  creditsQuoter: fakeCreditsQuoter(),
  ...overrides,
});

type ValueCall = { to: Address; data: Hex; value: bigint };

function valueCalls(data: Hex): ValueCall[] {
  const decoded = decodeFunctionData({ abi: tradeExecutorAbi, data });
  if (decoded.functionName === "batchValueExecute") return decoded.args[0].map((call) => ({ ...call }));
  if (decoded.functionName === "batchExecute") return decoded.args[0].map((call) => ({ ...call, value: 0n }));
  throw new Error(`Expected a batch, got ${decoded.functionName}`);
}

async function build(snap: PredictSnapshot, used: PredictDeps = deps(), at: PredictCtx = ctx(), batch = 1) {
  const step = planPredict(snap, used).find((each) => each.id === STEP_ID.predict(batch))!;
  return step.build(at, snap);
}

/** What the fake credits quote pays for `credits`, and the floor the batch must hold it to. */
const quoted = (credits: bigint) => (((credits * VAULT_RATE) / WAD) * (10_000n - 5n)) / 10_000n;
const floorOf = (credits: bigint) => (quoted(credits) * (10_000n - BigInt(CREDITS_SLIPPAGE_BPS))) / 10_000n;
const mintedFrom = (wxdai: bigint) => (wxdai * WAD) / VAULT_RATE;

describe("planPredict with credits", () => {
  it("moves the wallet's credits after the trade wallet exists and before the money is added", () => {
    expect(planPredict(creditsRun(), deps()).map((step) => step.id)).toEqual([
      STEP_ID.createExecutor,
      STEP_ID.addCredits,
      STEP_ID.deposit,
      STEP_ID.predict(1),
    ]);
  });

  it("has no Add credits step when the trade wallet already holds every credit spent", () => {
    const steps = planPredict(creditsRun({ creditsFromEoa: 0n, creditsAtStart: 2n * WAD }), deps());

    expect(steps.map((step) => step.id)).not.toContain(STEP_ID.addCredits);
  });

  it("transfers exactly the wallet's credits the popup showed, to the run's own trade wallet (A3, A6)", async () => {
    const step = planPredict(creditsRun(), deps()).find((each) => each.id === STEP_ID.addCredits)!;
    const tx = await step.build(ctx(), creditsRun());

    expect(tx.to).toBe(addresses.credits);
    expect(tx.value ?? 0n).toBe(0n);
    expect(decodeFunctionData({ abi: erc20Abi, data: tx.data! }).args).toEqual([addresses.executor, (3n * WAD) / 2n]);
  });

  it("skips Add credits once the trade wallet holds what it held at the start plus the transfer", async () => {
    const at = (balance: bigint) =>
      planPredict(creditsRun(), deps({ reader: fakeReader({ credits: { [addresses.executor]: balance } }) })).find(
        (each) => each.id === STEP_ID.addCredits,
      )!;

    await expect(at(2n * WAD).canSkip!(ctx(), creditsRun())).resolves.toBe(true);
    await expect(at(2n * WAD - 1n).canSkip!(ctx(), creditsRun())).resolves.toBe(false);
  });

  it("refuses a credits run on a network the credits contracts are not on", () => {
    const steps = planPredict(creditsRun(), deps());
    const add = steps.find((each) => each.id === STEP_ID.addCredits)!;

    expect(() => add.build(ctx({ credits: null }), creditsRun())).toThrow(PredictConfigError);
  });
});

describe("the first batch of a credits run", () => {
  it("spends the credits through the manager, unwraps, splits the xDAI at the parent, then splits the sDAI", async () => {
    const tx = await build(creditsRun());
    const calls = valueCalls(tx.data!);

    expect(decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data! }).functionName).toBe("batchValueExecute");
    expect(tx.value ?? 0n).toBe(0n);
    expect(calls.slice(0, 5).map((call) => call.to)).toEqual([
      addresses.manager,
      addresses.wxdai,
      addresses.router,
      addresses.collateral,
      addresses.router,
    ]);

    const [target, swap, amount, outputToken] = decodeFunctionData({
      abi: EXECUTE_ABI,
      data: calls[0]!.data,
    }).args;
    expect([target, amount, outputToken]).toEqual([addresses.swapRouter, 2n * WAD, addresses.wxdai]);

    const [params] = decodeFunctionData({ abi: ALGEBRA_ROUTER_ABI, data: swap }).args;
    expect(params).toMatchObject({
      tokenIn: addresses.collateral,
      tokenOut: addresses.wxdai,
      recipient: addresses.executor,
      amountIn: 2n * WAD,
      amountOutMinimum: floorOf(2n * WAD),
    });

    expect(decodeFunctionData({ abi: WXDAI_ABI, data: calls[1]!.data }).args).toEqual([floorOf(2n * WAD)]);
    const base = decodeFunctionData({ abi: gnosisRouterAbi, data: calls[2]!.data });
    expect(base.functionName).toBe("splitFromBase");
    expect(base.args).toEqual([addresses.parentMarket]);
    expect(calls[2]!.value).toBe(floorOf(2n * WAD));

    const split = decodeFunctionData({ abi: gnosisRouterAbi, data: calls[4]!.data });
    expect(split.functionName).toBe("splitPosition");
    expect(split.args).toEqual([addresses.collateral, addresses.parentMarket, 3n * WAD]);

    // only the parent split from xDAI carries native value
    expect(calls.filter((call) => call.value > 0n)).toHaveLength(1);
  });

  it("does not approve the trade wallet's sDAI to Swapr: the manager pays from its own", async () => {
    const calls = valueCalls((await build(creditsRun())).data!);
    const sDaiApprovals = calls
      .filter((call) => call.to === addresses.collateral && call.data.startsWith("0x095ea7b3"))
      .map((call) => decodeFunctionData({ abi: erc20Abi, data: call.data }).args[0]);

    expect(sDaiApprovals).toEqual([addresses.router]);
  });

  it("splits each option from both sources: the sDAI and what the unwrapped credits mint", async () => {
    const one = option(1);
    const tx = await build(
      creditsRun(),
      deps({ reader: fakeReader({ state: () => chainState({ underlying: WAD / 10n }) }) }),
    );
    const childSplits = valueCalls(tx.data!)
      .filter((call) => call.to === addresses.router)
      .map((call) => decodeFunctionData({ abi: gnosisRouterAbi, data: call.data }))
      .filter((call) => call.functionName === "splitPosition" && call.args[1] === one.childMarket);

    expect(childSplits.map((call) => call.args[2])).toEqual([WAD / 10n + 3n * WAD + mintedFrom(floorOf(2n * WAD))]);
  });

  it("with credits alone, splits only from xDAI at the parent", async () => {
    const tx = await build(creditsRun({ deposit: 0n, collateralIn: 0n }));
    const parentSplits = valueCalls(tx.data!)
      .filter((call) => call.to === addresses.router)
      .map((call) => decodeFunctionData({ abi: gnosisRouterAbi, data: call.data }))
      .filter((call) => call.functionName === "splitPosition" && call.args[1] === addresses.parentMarket);

    expect(parentSplits).toEqual([]);
    const base = valueCalls(tx.data!).filter((call) => call.value > 0n);
    expect(base).toHaveLength(1);
  });

  it("keeps every call to the allow-list, the owner's trade wallet and the value rule (A5, A6, P5)", async () => {
    const snap = creditsRun();
    const steps = planPredict(snap, deps({ quoter: fakeQuoter({ asSwapr: true }) }));
    const one = option(1);
    const sessionTokens = [addresses.collateral, one.underlying, one.upToken, one.downToken, one.invalidToken];

    for (const step of steps) {
      const tx = await step.build(ctx(), snap);
      expect(
        departures({ tx, ctx: ctx(), resolved: resolvedFrom(ctx(), addresses.swapRouter), sessionTokens }),
        step.id,
      ).toEqual([]);
    }
  });

  it("leaves a run without credits on batchExecute, with no native value", async () => {
    const tx = await build(snapshot());

    expect(decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data! }).functionName).toBe("batchExecute");
    expect(tx.value ?? 0n).toBe(0n);
  });

  it("spends credits in the first batch only", async () => {
    const options = [option(1), option(2)];
    // the first batch's parent split already gave every option its underlying
    const used = deps({ optionsPerBatch: 1, reader: fakeReader({ state: () => chainState({ underlying: WAD }) }) });
    const tx = await build(creditsRun({ options }), used, ctx(), 2);

    expect(decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data! }).functionName).toBe("batchExecute");
    expect(valueCalls(tx.data!).some((call) => call.to === addresses.manager)).toBe(false);
  });

  it("refuses before signing when the manager cannot cover the credits", async () => {
    const used = deps({ reader: fakeReader({ manager: 2n * WAD - 1n }) });

    await expect(build(creditsRun(), used)).rejects.toBeInstanceOf(CreditsUnavailableError);
  });

  it("refuses before signing when the swap would lose more than the cap against the vault rate", async () => {
    const used = deps({ creditsQuoter: fakeCreditsQuoter({ lossBps: BigInt(CREDITS_MAX_LOSS_BPS) + 1n }) });

    await expect(build(creditsRun(), used)).rejects.toBeInstanceOf(CreditsUnavailableError);
  });

  it("refuses a credits quote that routes anywhere but the whitelisted Swapr router, or pays anyone else", async () => {
    const elsewhere = "0x00000000000000000000000000000000000000ee" as Address;

    await expect(
      build(creditsRun(), deps({ creditsQuoter: fakeCreditsQuoter({ router: elsewhere }) })),
    ).rejects.toBeInstanceOf(CreditsUnavailableError);
    await expect(
      build(creditsRun(), deps({ creditsQuoter: fakeCreditsQuoter({ recipient: elsewhere }) })),
    ).rejects.toBeInstanceOf(CreditsUnavailableError);
  });

  it("refuses when no credits quoter was given", async () => {
    await expect(build(creditsRun(), deps({ creditsQuoter: undefined }))).rejects.toBeInstanceOf(PredictConfigError);
  });

  it("skips the first batch once its credits are burned, so a recovered run never spends them twice (A7)", async () => {
    const snap = creditsRun();
    // start 0.5 + moved 1.5 = 2 in the trade wallet; the batch burns all 2
    const at = (balance: bigint, mayHaveLanded = true) =>
      planPredict(
        snap,
        deps({
          reader: fakeReader({ credits: { [addresses.executor]: balance } }),
          batchMayHaveLanded: () => mayHaveLanded,
        }),
      ).find((each) => each.id === STEP_ID.predict(1))!;

    await expect(at(0n).canSkip!(ctx(), snap)).resolves.toBe(true);
    await expect(at(2n * WAD).canSkip!(ctx(), snap)).resolves.toBe(false);
    // outside a hash-less recovery, credits gone from the trade wallet were withdrawn, not burned
    await expect(at(0n, false).canSkip!(ctx(), snap)).resolves.toBe(false);
  });

  it("never skips the first batch of a run that spends no credits", async () => {
    const step = planPredict(snapshot(), deps()).find((each) => each.id === STEP_ID.predict(1))!;

    expect(step.canSkip === undefined || !(await step.canSkip(ctx(), snapshot()))).toBe(true);
  });
});

describe("assertRoutes with credits", () => {
  it("checks the credits leg and the options against what both sources will mint", async () => {
    const used = deps();

    await expect(assertRoutes(ctx(), creditsRun(), used)).resolves.toBeUndefined();
    expect((used.creditsQuoter as ReturnType<typeof fakeCreditsQuoter>).requests).toHaveLength(1);
  });

  it("refuses when the manager is short, before anything is signed", async () => {
    await expect(
      assertRoutes(ctx(), creditsRun(), deps({ reader: fakeReader({ manager: WAD }) })),
    ).rejects.toBeInstanceOf(CreditsUnavailableError);
  });
});

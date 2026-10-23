import {
  createFlowRunStore,
  createMemoryStorage,
  type FlowRunStore,
  type FlowTx,
  type StepSummary,
  type TxGateway,
} from "@foresight/tx-orchestrator";
import { type Address, type Hash, type TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addresses, ctx, fakeQuoter, fakeReader, option, snapshot, WAD } from "../../flow/__tests__/support/fakes";
import { STEP_ID } from "../../flow/plan";
import type { PredictCtx, PredictOption, PredictSnapshot } from "../../flow/types";
import { predictSteps } from "../../utils/predictSteps";
import { createPredictRun } from "../driver";
import type { PredictDriver, PredictFailureReason, PredictProgress } from "../types";

const OWNER_B = "0x00000000000000000000000000000000000000b1" as Address;
const EXECUTOR_B = "0x00000000000000000000000000000000000000b2" as Address;
const DEPOSIT_HASH = `0x${"d".repeat(64)}` as Hash;

/** A wallet that signs everything and a chain that mines it, including hashes it never signed. */
function fakeGateway(): TxGateway & { readonly signRequests: FlowTx[]; readonly receiptsAsked: Hash[] } {
  const signRequests: FlowTx[] = [];
  const receiptsAsked: Hash[] = [];
  const receipt = (hash: Hash): TransactionReceipt =>
    ({ transactionHash: hash, status: "success", blockNumber: 19_000_000n }) as TransactionReceipt;

  return {
    signRequests,
    receiptsAsked,
    sendTransaction: (tx) => {
      signRequests.push(tx);
      return Promise.resolve(`0x${signRequests.length.toString(16).padStart(64, "0")}` as Hash);
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
    getReceipt: (hash) => {
      receiptsAsked.push(hash);
      return Promise.resolve(receipt(hash));
    },
    isKnown: () => Promise.resolve(true),
  };
}

const FLOW_ID = "predict-session-7";

const pendingDeposit: StepSummary[] = [
  { stepId: STEP_ID.createExecutor, label: "Set up your trade wallet", outcome: { status: "skipped" } },
  { stepId: STEP_ID.deposit, label: "Add money to your trade wallet", outcome: { status: "pending" } },
  { stepId: STEP_ID.predict(1), label: "Making your prediction", outcome: { status: "pending" } },
];

const submittedDeposit: StepSummary[] = [
  { stepId: STEP_ID.createExecutor, label: "Set up your trade wallet", outcome: { status: "skipped" } },
  {
    stepId: STEP_ID.deposit,
    label: "Add money to your trade wallet",
    outcome: { status: "submitted", hash: DEPOSIT_HASH },
  },
  { stepId: STEP_ID.predict(1), label: "Making your prediction", outcome: { status: "pending" } },
];

const savedSnapshot = (): PredictSnapshot => snapshot({ deposit: WAD, collateralIn: WAD, collateralBefore: 0n });

/** A paused run saved while wallet A (the fixtures' owner) was connected on chain 100. */
function savedRunOfA(steps: StepSummary[], savedCtx: PredictCtx = ctx()): FlowRunStore {
  const store = createFlowRunStore({ storage: createMemoryStorage() });
  store.save<PredictSnapshot, PredictCtx>({
    flowId: FLOW_ID,
    adapterId: "predict-flow",
    status: "paused",
    reason: "rejected",
    ctx: savedCtx,
    snapshot: savedSnapshot(),
    steps,
  });
  return store;
}

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

function recover(store: FlowRunStore, current: PredictCtx, sessionOptions?: () => PredictOption[]) {
  const gateway = fakeGateway();
  const driver = createPredictRun({
    gateway,
    reader: fakeReader({ deployed: true, collateral: WAD }),
    quoter: fakeQuoter(),
    store,
    flowId: FLOW_ID,
    ctx: () => current,
    snapshot: savedSnapshot,
    sessionOptions,
  });
  drivers.push(driver);
  return { gateway, driver };
}

/** A recovered run reads as halted until it resumes, so only a reason, a prompt or the end counts as settled. */
async function settle(driver: PredictDriver, gateway: { signRequests: FlowTx[] }) {
  await vi.waitFor(() => {
    const progress = driver.getProgress();
    expect(progress.stage === "complete" || progress.failure !== undefined || gateway.signRequests.length > 0).toBe(
      true,
    );
  });
}

/** What the popup says about a halted run. */
const message = (progress: PredictProgress) =>
  predictSteps({ wallet: null, toAdd: 0n, symbol: "sDAI", decimals: 18, progress }).failure;

/** Reasons whose copy says nothing about which wallet or network to use. */
const GENERIC: PredictFailureReason[] = [
  "rejected",
  "cancelled",
  "reverted",
  "rpc",
  "unknown",
  "no-route",
  "quote",
  "balance",
  "deposit-unconfirmed",
];

const withReason = (progress: PredictProgress, reason: PredictFailureReason): PredictProgress => ({
  ...progress,
  failure: { reason, retryable: false },
});

const mismatches: Array<[string, PredictCtx]> = [
  ["a different wallet", ctx({ owner: OWNER_B, executor: EXECUTOR_B })],
  ["a different wallet that derives the same trade wallet address", ctx({ owner: OWNER_B })],
  ["the same wallet on a different chain", ctx({ chainId: 10200 })],
];

const savedStates: Array<[string, StepSummary[]]> = [
  ["a deposit not yet signed", pendingDeposit],
  ["a deposit submitted and mined", submittedDeposit],
];

describe("createPredictRun recovering a run saved by wallet A on chain 100", () => {
  describe.each(mismatches)("while %s is connected", (_, current) => {
    it.each(savedStates)("never prompts for a transaction, with %s", async (__, steps) => {
      const store = savedRunOfA(steps);
      const { gateway, driver } = recover(store, current);

      driver.start();
      await settle(driver, gateway);

      expect(gateway.signRequests).toEqual([]);

      // Asking again with the same wallet connected still prompts for nothing.
      driver.retry();
      driver.start();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(gateway.signRequests).toEqual([]);
    });

    it("halts with a message that tells the visitor which wallet or network to use", async () => {
      const store = savedRunOfA(pendingDeposit);
      const { gateway, driver } = recover(store, current);

      driver.start();
      await settle(driver, gateway);

      const progress = driver.getProgress();
      expect(progress.stage).toBe("halted");
      expect(progress.failure).toBeDefined();

      const shown = message(progress);
      expect(shown).toBeDefined();
      for (const reason of GENERIC) expect(shown).not.toBe(message(withReason(progress, reason)));
    });

    it.each(savedStates)("keeps A's saved run, with %s, for when A comes back", async (__, steps) => {
      const store = savedRunOfA(steps);
      const { gateway, driver } = recover(store, current);

      driver.start();
      await settle(driver, gateway);

      const kept = store.load<PredictSnapshot, PredictCtx>(FLOW_ID);
      expect(kept).not.toBeNull();
      expect(kept!.ctx).toEqual(ctx());
      expect(kept!.steps.find((step) => step.stepId === STEP_ID.deposit)?.outcome).toEqual(
        steps.find((step) => step.stepId === STEP_ID.deposit)?.outcome,
      );
    });
  });

  it("with A connected on chain 100, reconciles the submitted deposit and finishes without signing it again", async () => {
    const store = savedRunOfA(submittedDeposit);
    const { gateway, driver } = recover(store, ctx());

    driver.start();
    // a recovered run waits for the owner to review it before anything is signed
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("review"));
    driver.resume();
    await vi.waitFor(() => {
      const progress = driver.getProgress();
      expect(progress.stage === "complete" || progress.failure !== undefined).toBe(true);
    });

    expect(driver.getProgress().stage).toBe("complete");
    expect(gateway.receiptsAsked).toContain(DEPOSIT_HASH);
    expect(gateway.signRequests.filter((tx) => tx.to === addresses.collateral)).toEqual([]);
    expect(gateway.signRequests.length).toBeGreaterThan(0);
    expect(gateway.signRequests.every((tx) => tx.to === addresses.executor)).toBe(true);
  });
});

const ATTACKER = "0x00000000000000000000000000000000000000ad" as Address;
const live = ctx();

/** A run planted under A's key on chain 100 that names another contract than the app does. */
const planted: Array<[string, PredictCtx, PredictCtx]> = [
  ["trade wallet", ctx({ executor: ATTACKER }), live],
  ["sDAI adapter", ctx({ sDaiAdapter: ATTACKER }), live],
  ["collateral", ctx({ collateral: ATTACKER }), live],
  ["Seer router", ctx({ router: ATTACKER }), live],
  ["factory", ctx({ factory: ATTACKER }), live],
  ["parent market", ctx({ parentMarket: ATTACKER }), live],
  ["credits token", ctx({ credits: { ...live.credits!, token: ATTACKER } }), live],
  ["credits manager", ctx({ credits: { ...live.credits!, manager: ATTACKER } }), live],
  ["WXDAI", ctx({ credits: { ...live.credits!, wxdai: ATTACKER } }), live],
  ["credits swap router", ctx({ credits: { ...live.credits!, swaprRouter: ATTACKER } }), live],
  ["credits route, where the app has none", live, ctx({ credits: null })],
  ["sDAI adapter, where the app has none", live, ctx({ sDaiAdapter: null })],
];

describe("createPredictRun recovering a stored run whose contracts differ from the app's", () => {
  it.each(planted)("halts with nothing signed when the stored %s differs", async (_, stored, current) => {
    const store = savedRunOfA(pendingDeposit, stored);
    const { gateway, driver } = recover(store, current);

    driver.start();
    await vi.waitFor(() => expect(["halted", "review"]).toContain(driver.getProgress().stage));
    driver.resume();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(gateway.signRequests).toEqual([]);
    expect(driver.getProgress().stage).toBe("halted");
  });

  it("forgets such a run once the halted popup is reset, as it can never be continued", async () => {
    const store = savedRunOfA(pendingDeposit, ctx({ executor: ATTACKER }));
    const { gateway, driver } = recover(store, live);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    driver.reset();

    expect(store.load(FLOW_ID)).toBeNull();
    expect(gateway.signRequests).toEqual([]);
  });

  it("keeps such a run through reset while it holds a broadcast hash no receipt has been read for", async () => {
    const store = savedRunOfA(submittedDeposit, ctx({ executor: ATTACKER }));
    const { driver } = recover(store, live);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    driver.reset();

    expect(store.load(FLOW_ID)).not.toBeNull();
  });

  it("recovers a stored run whose addresses differ from the app's only in letter case", async () => {
    const upper = (address: Address) => address.toUpperCase().replace("0X", "0x") as Address;
    const store = savedRunOfA(
      pendingDeposit,
      ctx({ owner: upper(addresses.owner), credits: { ...live.credits!, manager: upper(addresses.manager) } }),
    );
    const { gateway, driver } = recover(store, live);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("review"));
    expect(gateway.signRequests).toEqual([]);
  });
});

/** A run planted under A's key with the app's contracts, whose first option names `stored` instead. */
function plantedOptions(stored: PredictOption): FlowRunStore {
  const store = createFlowRunStore({ storage: createMemoryStorage() });
  store.save<PredictSnapshot, PredictCtx>({
    flowId: FLOW_ID,
    adapterId: "predict-flow",
    status: "paused",
    reason: "rejected",
    ctx: ctx(),
    snapshot: { ...savedSnapshot(), options: [stored] },
    steps: pendingDeposit,
  });
  return store;
}

describe("createPredictRun recovering a stored run whose options differ from the session's", () => {
  const session = () => [option(1), option(2)];

  it.each([
    ["DOWN token", { ...option(1), downToken: ATTACKER }],
    ["UP token", { ...option(1), upToken: ATTACKER }],
    ["underlying", { ...option(1), underlying: ATTACKER }],
    ["INVALID token", { ...option(1), invalidToken: ATTACKER }],
    ["market, which the session does not have", { ...option(1), childMarket: ATTACKER }],
  ])("halts as unknown with nothing signed when the stored %s differs", async (_, stored) => {
    const store = plantedOptions(stored);
    const { gateway, driver } = recover(store, live, session);

    driver.start();
    await vi.waitFor(() => expect(["halted", "review"]).toContain(driver.getProgress().stage));
    driver.resume();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(gateway.signRequests).toEqual([]);
    expect(driver.getProgress().failure?.reason).toBe("unknown");
  });

  it("recovers a stored option whose addresses differ from the session's only in letter case", async () => {
    const upper = (address: Address) => address.toUpperCase().replace("0X", "0x") as Address;
    const store = plantedOptions({ ...option(1), downToken: upper(option(1).downToken) });
    const { gateway, driver } = recover(store, live, session);

    driver.start();

    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("review"));
    expect(gateway.signRequests).toEqual([]);
  });
});

import type { TxStep } from "@foresight/tx-orchestrator";
import { decodeFunctionData, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { sessionFactoryAbi } from "@/config/contracts";

import { CHILD_BATCH_SIZE } from "../params";
import { createSessionCreateHooks, planSessionDeploy, STEP_ID } from "../plan";
import type { DeployedMarkets, SessionDeployCtx, SessionDeploySnapshot, SessionLookup } from "../types";
import { childDeployedLog, DEPLOYER, FACTORY, minedReceipt } from "./support/chainLogs";
import { deploySnapshot as snapshot, NOW_MS } from "./support/deployFixtures";

/**
 * The plan is what the orchestrator signs. Its two jobs: never put more
 * children in one transaction than the gas limit allows, and never build a
 * child batch before the session id it belongs to is known.
 *
 * Sizes are counted in batches rather than written out, so retuning
 * `CHILD_BATCH_SIZE` moves these tests with it instead of reddening them.
 */

const ctx: SessionDeployCtx = { chainId: 31337, factory: FACTORY, deployer: DEPLOYER };

const THREE_BATCHES = CHILD_BATCH_SIZE * 2 + 2;
const ONE_TRANSACTION = CHILD_BATCH_SIZE;

/** Fails the test rather than the type checker when a step is missing. */
function stepAt(steps: TxStep<SessionDeploySnapshot, SessionDeployCtx>[], index: number) {
  const step = steps[index];
  if (!step) throw new Error(`The plan has no step at index ${index}; it has ${steps.length}.`);
  return step;
}

async function callFor(snapshot: SessionDeploySnapshot, index: number, whenBuilt = snapshot) {
  const tx = await stepAt(planSessionDeploy(snapshot, { now: NOW_MS }), index).build(ctx, whenBuilt);
  if (!tx.data) throw new Error("A session deploy step always carries calldata.");
  return { to: tx.to, ...decodeFunctionData({ abi: sessionFactoryAbi, data: tx.data }) };
}

describe("planSessionDeploy", () => {
  it("uses a single transaction for a session that fits", async () => {
    const steps = planSessionDeploy(snapshot(ONE_TRANSACTION), { now: NOW_MS });

    expect(steps).toHaveLength(1);
    expect((await callFor(snapshot(ONE_TRANSACTION), 0)).functionName).toBe("deploySession");
  });

  it("sends the transaction to the factory", async () => {
    expect((await callFor(snapshot(ONE_TRANSACTION), 0)).to).toBe(FACTORY);
  });

  it("splits a large session into a parent step and one step per batch", () => {
    expect(planSessionDeploy(snapshot(THREE_BATCHES), { now: NOW_MS }).map((s) => s.id)).toEqual([
      STEP_ID.parent,
      STEP_ID.batch(1),
      STEP_ID.batch(2),
      STEP_ID.batch(3),
    ]);
  });

  it("opens the phased session with the parent alone", async () => {
    const call = await callFor(snapshot(THREE_BATCHES), 0);

    if (call.functionName !== "openPhasedSession") throw new Error(`Built ${call.functionName} instead.`);
    expect(call.args[2]).toBe("/ipfs/QmDoc");
  });

  it("labels the steps", () => {
    expect(planSessionDeploy(snapshot(THREE_BATCHES), { now: NOW_MS }).map((s) => s.label)).toEqual([
      "Create the decision market",
      `Create branches 1-${CHILD_BATCH_SIZE}`,
      `Create branches ${CHILD_BATCH_SIZE + 1}-${CHILD_BATCH_SIZE * 2}`,
      `Create branches ${CHILD_BATCH_SIZE * 2 + 1}-${THREE_BATCHES}`,
    ]);
  });

  it("builds a child batch against the session id", async () => {
    const snap = snapshot(THREE_BATCHES);

    const call = await callFor(snap, 1, { ...snap, sessionId: 42n });

    if (call.functionName !== "deploySessionChildBatch") throw new Error(`Built ${call.functionName} instead.`);
    expect(call.args[0]).toBe(42n);
    expect(call.args[1]).toHaveLength(CHILD_BATCH_SIZE);
  });

  it("refuses to build a batch before the session id is known", async () => {
    const snap = snapshot(THREE_BATCHES);

    await expect(async () => stepAt(planSessionDeploy(snap, { now: NOW_MS }), 1).build(ctx, snap)).rejects.toThrow(
      /session id/i,
    );
  });

  it("refuses to build anything without a metadata uri", async () => {
    const snap = snapshot(ONE_TRANSACTION, { metadataUri: undefined });

    await expect(async () => stepAt(planSessionDeploy(snap, { now: NOW_MS }), 0).build(ctx, snap)).rejects.toThrow(
      /metadata/i,
    );
  });

  it("refuses to plan a draft whose trading period has ended", () => {
    const snap = snapshot(ONE_TRANSACTION);
    const afterTradingClosed = (snap.deploy.parent.openingTime + 1) * 1000;

    expect(() => planSessionDeploy(snap, { now: afterTradingClosed })).toThrow(/already closed/i);
  });

  it("refuses a draft whose branch has closed even when the decision has not", () => {
    const snap = snapshot(ONE_TRANSACTION);
    const decisionStillOpen: SessionDeploySnapshot = {
      ...snap,
      deploy: { ...snap.deploy, parent: { ...snap.deploy.parent, openingTime: 1_900_000_000 } },
    };

    expect(() => planSessionDeploy(decisionStillOpen, { now: 1_850_000_000_000 })).toThrow(/branch 1/i);
  });

  // Refusing here would strand a session only the deployer can finish.
  it("plans a stale draft once the session exists", () => {
    const snap: SessionDeploySnapshot = { ...snapshot(THREE_BATCHES), sessionId: 42n };
    const afterTradingClosed = (snap.deploy.parent.openingTime + 1) * 1000;

    expect(() => planSessionDeploy(snap, { now: afterTradingClosed })).not.toThrow();
  });

  it("gives the session-opening step no skip test without a lookup", () => {
    // `reconcileInFlight` reads `Boolean(step.canSkip)` for `canSelfCheck`.
    const steps = planSessionDeploy(snapshot(THREE_BATCHES), { now: NOW_MS });

    expect(stepAt(steps, 0).canSkip).toBeUndefined();
  });

  it("skips a batch whose children are already on chain", async () => {
    const snap = snapshot(THREE_BATCHES);
    const firstBatchDone: SessionDeploySnapshot = {
      ...snap,
      sessionId: 42n,
      childMarkets: Array.from({ length: CHILD_BATCH_SIZE }, (_, i): Address => `0x${String(i).repeat(40)}`),
    };
    const steps = planSessionDeploy(snap, { now: NOW_MS });

    expect(await stepAt(steps, 1).canSkip?.(ctx, firstBatchDone)).toBe(true);
    expect(await stepAt(steps, 2).canSkip?.(ctx, firstBatchDone)).toBe(false);
  });
});

/** Nothing on chain stops `openPhasedSession` being called twice. */
describe("planSessionDeploy, with a session lookup", () => {
  const found = (overrides: Partial<DeployedMarkets> = {}): DeployedMarkets => ({
    sessionId: 42n,
    parentMarket: "0xparent",
    childMarkets: [],
    ...overrides,
  });

  function lookupReturning(result: DeployedMarkets | null) {
    const asked: Parameters<SessionLookup>[0][] = [];
    const findSession: SessionLookup = async (args) => {
      asked.push(args);
      return result;
    };
    return { findSession, asked };
  }

  it("skips opening a session that already exists", async () => {
    const { findSession } = lookupReturning(found());
    const snap = snapshot(THREE_BATCHES);

    const steps = planSessionDeploy(snap, { now: NOW_MS, findSession });

    expect(await stepAt(steps, 0).canSkip?.(ctx, snap)).toBe(true);
  });

  it("skips an atomic deploy whose session already exists", async () => {
    const { findSession } = lookupReturning(found());
    const snap = snapshot(ONE_TRANSACTION);

    const steps = planSessionDeploy(snap, { now: NOW_MS, findSession });

    expect(steps).toHaveLength(1);
    expect(await stepAt(steps, 0).canSkip?.(ctx, snap)).toBe(true);
  });

  it("opens one when the lookup finds none", async () => {
    const { findSession } = lookupReturning(null);
    const snap = snapshot(THREE_BATCHES);

    const steps = planSessionDeploy(snap, { now: NOW_MS, findSession });

    expect(await stepAt(steps, 0).canSkip?.(ctx, snap)).toBe(false);
  });

  it("scopes the question to this deployer, document and run", async () => {
    const { findSession, asked } = lookupReturning(null);
    const snap = snapshot(THREE_BATCHES);

    await stepAt(planSessionDeploy(snap, { now: NOW_MS, findSession }), 0).canSkip?.(ctx, snap);

    expect(asked[0]).toEqual({
      deployer: DEPLOYER,
      metadataUri: "/ipfs/QmDoc",
      since: Math.floor(NOW_MS / 1000),
    });
  });

  it("does not ask once the snapshot has a session id", async () => {
    const { findSession, asked } = lookupReturning(null);
    const snap: SessionDeploySnapshot = { ...snapshot(THREE_BATCHES), sessionId: 42n };

    await stepAt(planSessionDeploy(snap, { now: NOW_MS, findSession }), 0).canSkip?.(ctx, snap);

    expect(asked).toHaveLength(0);
  });

  // The driver turns a `canSkip` throw into a stop, not a false.
  it("propagates a lookup that cannot answer", async () => {
    const findSession: SessionLookup = async () => {
      throw new Error("The indexer is 20 blocks behind the chain.");
    };
    const snap = snapshot(THREE_BATCHES);

    const steps = planSessionDeploy(snap, { now: NOW_MS, findSession });

    await expect(async () => steps[0]?.canSkip?.(ctx, snap)).rejects.toThrow(/behind the chain/);
  });

  /**
   * A tab closed with the wallet open leaves no hash to reconcile: the batch
   * landed and this run never learned of it. The indexer is the only witness.
   */
  describe("a batch this run has no record of", () => {
    const landed = (count: number) =>
      found({
        childMarkets: Array.from({ length: count }, (_, index) => ({
          outcomeIndex: index,
          address: `0x${String(index).repeat(40)}` as Address,
        })),
      });

    it("is skipped when the lookup accounts for its branches", async () => {
      const { findSession } = lookupReturning(landed(CHILD_BATCH_SIZE));
      const snap = snapshot(THREE_BATCHES);

      const steps = planSessionDeploy(snap, { now: NOW_MS, findSession });

      expect(await stepAt(steps, 1).canSkip?.(ctx, snap)).toBe(true);
      expect(await stepAt(steps, 2).canSkip?.(ctx, snap)).toBe(false);
    });

    it("is signed when the lookup accounts for none of them", async () => {
      const { findSession } = lookupReturning(found());
      const snap = snapshot(THREE_BATCHES);

      const steps = planSessionDeploy(snap, { now: NOW_MS, findSession });

      expect(await stepAt(steps, 1).canSkip?.(ctx, snap)).toBe(false);
    });

    // Signing a batch that exists reverts on the index check; leaving a session
    // unfinishable because the indexer was down does not undo itself.
    it("is signed rather than stalled when the lookup will not answer", async () => {
      const findSession: SessionLookup = async () => {
        throw new Error("The indexer is 20 blocks behind the chain.");
      };
      const snap = snapshot(THREE_BATCHES);

      const steps = planSessionDeploy(snap, { now: NOW_MS, findSession });

      expect(await stepAt(steps, 1).canSkip?.(ctx, snap)).toBe(false);
    });

    it("is signed when there is no lookup to ask", async () => {
      const snap = snapshot(THREE_BATCHES);

      const steps = planSessionDeploy(snap, { now: NOW_MS });

      expect(await stepAt(steps, 1).canSkip?.(ctx, snap)).toBe(false);
    });

    // Indices the branch list does not have would otherwise skip every batch.
    it("is signed when the lookup answers with indices outside the range", async () => {
      const { findSession } = lookupReturning(
        found({ childMarkets: [{ outcomeIndex: THREE_BATCHES + 40, address: "0xrogue" }] }),
      );
      const snap = snapshot(THREE_BATCHES);

      const batches = planSessionDeploy(snap, { now: NOW_MS, findSession }).slice(1);

      expect(await Promise.all(batches.map((step) => step.canSkip?.(ctx, snap)))).toEqual([false, false, false]);
    });
  });
});

describe("createSessionCreateHooks, on a skipped step", () => {
  it("patches in everything the lookup found", async () => {
    const findSession: SessionLookup = async () => ({
      sessionId: 42n,
      parentMarket: "0xparent",
      childMarkets: [{ outcomeIndex: 1, address: "0xchild1" }],
    });
    const snap = snapshot(THREE_BATCHES);

    const result = await createSessionCreateHooks({ findSession }).afterStep?.({
      ctx,
      snapshot: snap,
      completed: { stepId: STEP_ID.parent, label: "Create the decision market", outcome: { status: "skipped" } },
      receipt: null,
      pending: [],
    });
    const patch = result?.snapshotPatch;
    if (typeof patch !== "function") throw new Error("A skipped step that found a session patches by function.");

    expect(patch(snap)).toMatchObject({
      sessionId: 42n,
      parentMarket: "0xparent",
      childMarkets: [undefined, "0xchild1"],
    });
  });

  it("ignores a child index outside the branch range", async () => {
    const findSession: SessionLookup = async () => ({
      sessionId: 42n,
      parentMarket: "0xparent",
      childMarkets: [
        { outcomeIndex: THREE_BATCHES + 40, address: "0xrogue" },
        { outcomeIndex: -1, address: "0xrogue" },
      ],
    });
    const snap = snapshot(THREE_BATCHES);

    const result = await createSessionCreateHooks({ findSession }).afterStep?.({
      ctx,
      snapshot: snap,
      completed: { stepId: STEP_ID.parent, label: "Create the decision market", outcome: { status: "skipped" } },
      receipt: null,
      pending: [],
    });
    const patch = result?.snapshotPatch;
    if (typeof patch !== "function") throw new Error("A skipped step that found a session patches by function.");
    const patched = patch(snap);

    // Deep-equal, not just length: a negative index sets a property, not an element.
    expect(patched.childMarkets).toEqual([]);
    // The batch skip reads that length, so an inflated one skips every batch.
    const steps = planSessionDeploy(snap, { now: NOW_MS, findSession });
    const skips = await Promise.all(steps.slice(1).map((step) => step.canSkip?.(ctx, patched)));
    expect(skips).toEqual([false, false, false]);
  });

  it("patches nothing without a lookup", async () => {
    const result = await createSessionCreateHooks().afterStep?.({
      ctx,
      snapshot: snapshot(THREE_BATCHES),
      completed: { stepId: STEP_ID.parent, label: "Create the decision market", outcome: { status: "skipped" } },
      receipt: null,
      pending: [],
    });

    expect(result).toBeUndefined();
  });
});

describe("sessionCreateFlow.afterStep", () => {
  it("claims nothing from a receipt with no session events", async () => {
    const result = await createSessionCreateHooks().afterStep?.({
      ctx,
      snapshot: snapshot(THREE_BATCHES),
      completed: {
        stepId: STEP_ID.batch(1),
        label: "Create branches 1-6",
        outcome: { status: "confirmed", hash: "0x1", blockNumber: 1n },
      },
      receipt: minedReceipt([]),
      pending: [],
    });

    expect(result?.snapshotPatch).toBeUndefined();
  });

  it("folds a child address in at its outcome index", async () => {
    const snap = snapshot(THREE_BATCHES);

    const result = await createSessionCreateHooks().afterStep?.({
      ctx,
      snapshot: snap,
      completed: {
        stepId: STEP_ID.batch(1),
        label: "Create branches 1-6",
        outcome: { status: "confirmed", hash: "0x1", blockNumber: 1n },
      },
      receipt: minedReceipt([childDeployedLog({ sessionId: 42n, outcomeIndex: 2n })]),
      pending: [],
    });
    const patch = result?.snapshotPatch;
    if (typeof patch !== "function") throw new Error("A receipt with events patches by function, not by partial.");
    const patched = patch(snap);

    expect(patched.childMarkets[2]).toBeDefined();
    expect(patched.childMarkets[0]).toBeUndefined();
  });
});

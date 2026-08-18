import type { FlowHooks, TxStep } from "@foresight/tx-orchestrator";
import { encodeFunctionData } from "viem";

import { sessionFactoryAbi } from "@/config/contracts";

import { buildChildConfigs, buildParentConfig, childBatches, type ChildConfig } from "./params";
import { readDeployedMarkets } from "./receipts";
import type { DeployedMarkets, SessionDeployCtx, SessionDeploySnapshot, SessionLookup } from "./types";

/**
 * The `session-create-flow` adapter.
 *
 * A session id only exists once the parent confirms, so every batch is built
 * from the snapshot at the moment it runs rather than up front.
 */

type Step = TxStep<SessionDeploySnapshot, SessionDeployCtx>;

const BATCH_PREFIX = "children-";

/**
 * The ids a plan gives its steps.
 */
export const STEP_ID = {
  /** Atomic: parent and children in one transaction. */
  atomic: "deploy",
  /** Phased: the parent on its own, then a batch per transaction. */
  parent: "parent",
  batch: (batchNumber: number) => `${BATCH_PREFIX}${batchNumber}`,
} as const;

/** The batch a step id names, 1-based, or null where it names no batch. */
export function batchNumberOf(stepId: string): number | null {
  if (!stepId.startsWith(BATCH_PREFIX)) return null;
  const batch = Number(stepId.slice(BATCH_PREFIX.length));
  return Number.isInteger(batch) && batch > 0 ? batch : null;
}

function requireMetadata(snapshot: SessionDeploySnapshot): string {
  if (!snapshot.metadataUri) {
    throw new Error("The display metadata has not been uploaded yet.");
  }
  return snapshot.metadataUri;
}

function configsFor(snapshot: SessionDeploySnapshot): ChildConfig[] {
  return buildChildConfigs(snapshot.deploy.children, {
    parentOutcomeCount: snapshot.deploy.parent.outcomes.length,
    parentOpeningTime: snapshot.deploy.parent.openingTime,
  });
}

function assertNotAlreadyClosed(snapshot: SessionDeploySnapshot, now: number): void {
  if (snapshot.sessionId !== undefined) return;

  const nowSeconds = Math.floor(now / 1000);
  const closed = [
    { what: "The decision", openingTime: snapshot.deploy.parent.openingTime },
    ...snapshot.deploy.children.map((child) => ({
      what: `Branch ${child.parentOutcomeIndex + 1}`,
      openingTime: child.openingTime,
    })),
  ].filter((moment) => moment.openingTime <= nowSeconds);

  const first = closed[0];
  if (first) {
    throw new Error(`${first.what} already closed, at ${new Date(first.openingTime * 1000).toISOString()}.`);
  }
}

function batchLabel(batch: ChildConfig[]): string {
  const first = Number(batch[0]?.parentOutcomeIndex ?? 0n) + 1;
  const last = Number(batch[batch.length - 1]?.parentOutcomeIndex ?? 0n) + 1;
  return first === last ? `Create branch ${first}` : `Create branches ${first}-${last}`;
}

function askedOf(findSession: SessionLookup, ctx: SessionDeployCtx, snap: SessionDeploySnapshot) {
  return findSession({
    deployer: ctx.deployer,
    metadataUri: requireMetadata(snap),
    since: snap.startedAt,
  });
}

/**
 * How far the branches reach once an answer is folded in, read through the patch
 * the snapshot itself would take: an index counted here is one kept there.
 */
function childrenThrough(found: DeployedMarkets | null, snap: SessionDeploySnapshot): number {
  return found ? foldInto(found)(snap).childMarkets.length : snap.childMarkets.length;
}

/**
 * Whether a batch's children are on chain already.
 *
 * A lookup that will not answer is not fatal here the way it is for the parent:
 * signing a batch that exists reverts on the contract's index check, where
 * opening a second session cannot be undone.
 */
async function batchLanded(
  findSession: SessionLookup,
  ctx: SessionDeployCtx,
  snap: SessionDeploySnapshot,
  through: number,
): Promise<boolean> {
  try {
    return childrenThrough(await askedOf(findSession, ctx, snap), snap) >= through;
  } catch {
    return false;
  }
}

/**
 * @param now milliseconds, required so no call site can omit the staleness check.
 * @param findSession function to lookup if a session was already deployed before interruption
 */
export function planSessionDeploy(
  snapshot: SessionDeploySnapshot,
  opts: { now: number; findSession?: SessionLookup },
): Step[] {
  assertNotAlreadyClosed(snapshot, opts.now);
  const { findSession } = opts;

  // Each `deploySession` or `openPhasedSession` call takes the next session id,
  // so a repeat is a second session rather than a no-op.
  const alreadyOpened = findSession
    ? async (ctx: SessionDeployCtx, snap: SessionDeploySnapshot) =>
        snap.sessionId !== undefined || (await askedOf(findSession, ctx, snap)) !== null
    : undefined;

  const atomic: Step = {
    id: STEP_ID.atomic,
    label: "Create the session",
    canSkip: alreadyOpened,
    build: (_ctx, snap) => ({
      to: _ctx.factory,
      data: encodeFunctionData({
        abi: sessionFactoryAbi,
        functionName: "deploySession",
        args: [
          {
            parent: buildParentConfig(snap.deploy.parent),
            children: configsFor(snap),
            multiCategoricalParent: snap.deploy.multiCategoricalParent,
            metadataUri: requireMetadata(snap),
          },
        ],
      }),
    }),
  };

  if (snapshot.mode === "atomic") return [atomic];

  const parent: Step = {
    id: STEP_ID.parent,
    label: "Create the decision market",
    canSkip: alreadyOpened,
    build: (ctx, snap) => ({
      to: ctx.factory,
      data: encodeFunctionData({
        abi: sessionFactoryAbi,
        functionName: "openPhasedSession",
        args: [buildParentConfig(snap.deploy.parent), snap.deploy.multiCategoricalParent, requireMetadata(snap)],
      }),
    }),
  };

  const batches = childBatches(configsFor(snapshot));

  return [
    parent,
    ...batches.map((batch, index): Step => {
      const alreadyDeployed = Number(batch[batch.length - 1]?.parentOutcomeIndex ?? 0n) + 1;

      return {
        id: STEP_ID.batch(index + 1),
        label: batchLabel(batch),
        // Resuming after the tab closed mid-deploy: if the chain already has
        // these children, signing again would revert on the index check. A tab
        // that closed with the wallet open leaves no hash to reconcile, so the
        // indexer is the only witness left.
        canSkip: async (ctx, snap) =>
          snap.childMarkets.length >= alreadyDeployed ||
          (findSession !== undefined && (await batchLanded(findSession, ctx, snap, alreadyDeployed))),
        build: (ctx, snap) => {
          if (snap.sessionId === undefined) {
            // Reachable only from a parent receipt with no ParentMarketDeployed
            // log for `ctx.factory`.
            throw new Error("The decision market confirmed without a session id.");
          }
          // Rebuilt rather than taking `batch`, so a re-plan encodes what is true now.
          const current = childBatches(configsFor(snap))[index] ?? [];
          return {
            to: ctx.factory,
            data: encodeFunctionData({
              abi: sessionFactoryAbi,
              functionName: "deploySessionChildBatch",
              args: [snap.sessionId, current],
            }),
          };
        },
      };
    }),
  ];
}

function foldInto(found: DeployedMarkets) {
  return (previous: SessionDeploySnapshot): SessionDeploySnapshot => ({
    ...previous,
    sessionId: found.sessionId ?? previous.sessionId,
    parentMarket: found.parentMarket ?? previous.parentMarket,
    // Indexed by outcome so a repeated answer cannot append a duplicate, and
    // bounded by the branch count because an index past it would leave a gap
    // that inflates `length`, which is what the batch skip reads.
    childMarkets: found.childMarkets.reduce(
      (all, child) => {
        if (child.outcomeIndex >= 0 && child.outcomeIndex < previous.deploy.children.length) {
          all[child.outcomeIndex] = child.address;
        }
        return all;
      },
      [...previous.childMarkets],
    ),
  });
}

const nothingIn = (found: DeployedMarkets) => found.sessionId === undefined && found.childMarkets.length === 0;

/**
 * What the indexer has of a run, as the snapshot it implies and the transactions
 * behind it. A tab that closed with the wallet open leaves no hash to reconcile,
 * so this is the only witness to work that landed anyway.
 */
export async function witnessSession(
  findSession: SessionLookup,
  ctx: SessionDeployCtx,
  snapshot: SessionDeploySnapshot,
): Promise<{ snapshot: SessionDeploySnapshot; found: DeployedMarkets } | null> {
  const found = await askedOf(findSession, ctx, snapshot);
  if (!found || nothingIn(found)) return null;
  return { snapshot: foldInto(found)(snapshot), found };
}

export function createSessionCreateHooks(
  deps: { findSession?: SessionLookup } = {},
): FlowHooks<SessionDeploySnapshot, SessionDeployCtx> {
  return {
    async afterStep({ ctx, snapshot, receipt, completed }) {
      if (!receipt) {
        if (completed.outcome.status !== "skipped" || !deps.findSession) return;

        const found = await askedOf(deps.findSession, ctx, snapshot);
        if (!found || nothingIn(found)) return;
        return { snapshotPatch: foldInto(found) };
      }

      const found = readDeployedMarkets(receipt, ctx.factory);
      if (nothingIn(found)) return;

      return {
        snapshotPatch: foldInto(found),
        inform:
          completed.stepId === STEP_ID.parent && found.parentMarket
            ? "Decision market created. The branches come next."
            : undefined,
      };
    },
  };
}

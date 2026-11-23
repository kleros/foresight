import {
  createFlowRunStore,
  createMemoryStorage,
  type BalanceTxGateway,
  type FlowRunStorage,
  type FlowTx,
} from "@foresight/tx-orchestrator";
import { getAddress, type Address, type Hash, type Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chain, copyStorage, gateway, timesBroadcast, wallet, type Chain, type PromptScript } from "./support/world";
import type { ParentResolution } from "../../api/getSessionResolution";
import { planWalletRedeem, type WalletRedeemInput } from "../plan";
import { createRedeemRun } from "../run";

const WAD = 10n ** 18n;
const at = (prefix: string): Address => getAddress(`0x${prefix.padEnd(40, "0")}`);
const OWNER: Address = "0x00000000000000000000000000000000000000a1";
const OTHER: Address = "0x00000000000000000000000000000000000000a2";
const SDAI: Address = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
const PARENT = at("b0");
const TOKEN_A = at("e00");
const TOKEN_B = at("e01");
const INVALID = at("e02");

const PARENT_RESOLVED: ParentResolution = {
  resolved: true,
  invalid: false,
  winningOutcomes: [0],
  payoutNumerators: [1n, 0n, 0n],
  payoutDenominator: 1n,
};

/** Parent tokens only: one approve and one redeemPositions. */
const INPUT: WalletRedeemInput = {
  chainId: 100,
  owner: OWNER,
  collateral: SDAI,
  parentMarket: PARENT,
  resolution: { parent: PARENT_RESOLVED, children: {} },
  parentTokens: [
    { token: TOKEN_A, balance: 3n * WAD },
    { token: TOKEN_B, balance: WAD },
    { token: INVALID, balance: 0n },
  ],
  childTokens: {},
};

type Run = ReturnType<typeof createRedeemRun>;
const runs: Run[] = [];
afterEach(() => {
  for (const run of runs.splice(0)) run.dispose();
});

let PLANNED: FlowTx[] = [];
beforeEach(() => {
  PLANNED = planWalletRedeem(INPUT).calls;
});

interface CallsStatusAnswer {
  status: number;
}

interface Written {
  snapshot?: { sends?: Record<string, unknown>; callsId?: string };
}

/** Storage that refuses the first write `refuses` matches, as a full localStorage does, and takes every other. */
function refusesOnce(refuses: (run: Written) => boolean): FlowRunStorage {
  const storage = createMemoryStorage();
  let refused = false;
  return {
    ...storage,
    setItem(key, value) {
      if (!refused && refuses(JSON.parse(value) as Written)) {
        refused = true;
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      storage.setItem(key, value);
    },
  };
}

function tab(
  world: Chain,
  opts: {
    storage?: FlowRunStorage;
    script?: (index: number, tx: FlowTx) => PromptScript;
    /** Whether the n-th prompt's transaction mines reverted. */
    reverts?: (index: number) => boolean;
    atomic?: boolean;
    sendCalls?: "answer" | "unmined";
    /** Replaces the wallet's wallet_getCallsStatus answer while it returns one. */
    callsStatus?: () => CallsStatusAnswer | undefined;
    account?: Address;
    chainId?: number;
  } = {},
) {
  const storage = opts.storage ?? createMemoryStorage();
  const sends = gateway(world, OWNER, opts.script ? { script: opts.script } : {});
  const reverted = new Set<Hash>();
  let sent = 0;
  const revertedReceipt = <T extends { status: string } | null>(hash: Hash, receipt: T): T =>
    receipt && reverted.has(hash) ? { ...receipt, status: "reverted" } : receipt;
  const port: BalanceTxGateway = {
    ...sends.port,
    sendTransaction: async (tx, options) => {
      const index = sent++;
      const hash = await sends.port.sendTransaction(tx, options);
      if (opts.reverts?.(index)) reverted.add(hash);
      return hash;
    },
    waitForReceipt: async (args) => revertedReceipt(args.hash, await sends.port.waitForReceipt(args)),
    getReceipt: async (hash) => revertedReceipt(hash, await sends.port.getReceipt(hash)),
  };
  const batch = wallet(world, OWNER, {
    atomic: opts.atomic ?? false,
    ...(opts.sendCalls ? { sendCalls: opts.sendCalls } : {}),
  });
  const walletPort = {
    request: async (args: { method: string; params?: unknown }) => {
      const answer = args.method === "wallet_getCallsStatus" ? opts.callsStatus?.() : undefined;
      return answer ?? batch.port.request(args);
    },
  };
  const run = createRedeemRun({
    gateway: port,
    wallet: walletPort,
    reader: {
      ...world.reader,
      balanceOf: (token: Address) => Promise.resolve(INPUT.parentTokens.find((h) => h.token === token)?.balance ?? 0n),
    },
    store: createFlowRunStore({ storage }),
    flowId: "redeem-recovery",
    account: () => opts.account ?? OWNER,
    chainId: () => opts.chainId ?? 100,
    request: () => INPUT,
    now: () => 1_700_000_000_000,
    pollMs: 5,
  });
  runs.push(run);
  return { run, sends, batch, storage, reverted };
}

const progress = (run: Run) => run.getProgress();
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
const storedRun = (storage: FlowRunStorage) => createFlowRunStore({ storage }).load("redeem-recovery");
const sameCalls = (sent: FlowTx[], expected: FlowTx[]) =>
  expect(sent.map((tx) => [tx.to, tx.data])).toEqual(expected.map((tx) => [tx.to, tx.data]));
const settled = (run: Run) =>
  vi.waitFor(() => expect(["complete", "halted", "review"]).toContain(progress(run).stage), { timeout: 3_000 });

/** A one-by-one run whose prompt `stuck` was open when the tab closed. */
async function leftOpen(world: Chain, stuck: number) {
  const first = tab(world, { script: (index) => (index === stuck ? "hang" : "sign") });
  first.run.start();
  await first.sends.held();
  const left = copyStorage(first.storage);
  first.run.dispose();
  return { left, hung: first.sends.hung[0]! };
}

/** A second tab on `left`, recovered and resumed until it rests. */
async function reopened(world: Chain, left: FlowRunStorage, opts: Parameters<typeof tab>[1] = {}) {
  const next = tab(world, { ...opts, storage: left });
  next.run.recover();
  await vi.waitFor(() => expect(progress(next.run).stage).toBe("review"), { timeout: 3_000 });
  next.run.resume();
  await settled(next.run);
  return next;
}

describe("createRedeemRun after a send that cannot land", () => {
  it("one by one: a reverted redeem halts, and the next press signs a new run", async () => {
    const world = chain();
    const { run, sends } = tab(world, { reverts: (index) => index === 1 });

    run.start();
    await settled(run);
    expect(progress(run)).toEqual({ stage: "halted", failure: { reason: "reverted", retryable: false } });
    expect(sends.prompts).toHaveLength(2);

    run.start();
    await vi.waitFor(() => expect(progress(run).stage).toBe("complete"), { timeout: 3_000 });
    expect(sends.prompts).toHaveLength(2 + PLANNED.length);
  });

  it("one by one: after a reload, the next press on a reverted run signs a new run", async () => {
    const world = chain();
    const first = tab(world, { reverts: (index) => index === 1 });
    first.run.start();
    await settled(first.run);
    expect(progress(first.run).failure?.reason).toBe("reverted");
    const left = copyStorage(first.storage);
    first.run.dispose();

    const next = tab(world, { storage: left });
    next.run.start();
    await vi.waitFor(() => expect(progress(next.run).stage).toBe("complete"), { timeout: 3_000 });
    expect(next.sends.prompts).toHaveLength(PLANNED.length);
  });

  it("atomic: a batch the wallet reports as failed halts, and the next press sends a new batch", async () => {
    const world = chain();
    let failed = true;
    const { run, batch } = tab(world, {
      atomic: true,
      callsStatus: () => (failed ? { status: 500 } : undefined),
    });

    run.start();
    await settled(run);
    expect(progress(run)).toEqual({ stage: "halted", failure: { reason: "batch-failed", retryable: false } });
    expect(batch.sendCalls).toHaveLength(1);

    failed = false;
    run.start();
    await vi.waitFor(() => expect(progress(run).stage).toBe("complete"), { timeout: 3_000 });
    expect(batch.sendCalls).toHaveLength(2);
  });

  it("atomic: after a reload, the next press on a failed batch sends a new batch", async () => {
    const world = chain();
    const first = tab(world, { atomic: true, callsStatus: () => ({ status: 400 }) });
    first.run.start();
    await settled(first.run);
    expect(progress(first.run).failure?.reason).toBe("batch-failed");
    const left = copyStorage(first.storage);
    first.run.dispose();

    const next = tab(world, { storage: left, atomic: true });
    next.run.start();
    await vi.waitFor(() => expect(progress(next.run).stage).toBe("complete"), { timeout: 3_000 });
    expect(next.batch.sendCalls).toHaveLength(1);
  });
});

describe("createRedeemRun when the send cannot be stored", () => {
  it("one by one: stops as storage with no prompt, and the retry signs every call", async () => {
    const world = chain();
    const storage = refusesOnce((run) => Object.keys(run.snapshot?.sends ?? {}).length > 0);
    const { run, sends } = tab(world, { storage });

    run.start();
    await settled(run);
    expect(progress(run)).toEqual({ stage: "halted", failure: { reason: "storage", retryable: true } });
    expect(sends.prompts).toEqual([]);

    run.retry();
    await vi.waitFor(() => expect(progress(run).stage).toBe("complete"), { timeout: 3_000 });
    expect(sends.prompts).toHaveLength(PLANNED.length);
  });

  it("atomic: stops as storage with no batch sent, and the retry sends it", async () => {
    const world = chain();
    const storage = refusesOnce((run) => run.snapshot?.callsId !== undefined);
    const { run, batch } = tab(world, { storage, atomic: true });

    run.start();
    await settled(run);
    expect(progress(run)).toEqual({ stage: "halted", failure: { reason: "storage", retryable: true } });
    expect(batch.sendCalls).toEqual([]);

    run.retry();
    await vi.waitFor(() => expect(progress(run).stage).toBe("complete"), { timeout: 3_000 });
    expect(batch.sendCalls).toHaveLength(1);
  });
});

describe("createRedeemRun reads a stored send back after a reload", () => {
  it("asks wallet_sendCalls from the connected account", async () => {
    const world = chain();
    const { run, batch } = tab(world, { atomic: true });

    run.start();
    await settled(run);

    expect(batch.sendCalls.map((request) => request.from)).toEqual([OWNER]);
  });

  it("stops as held, signing nothing, when another transaction took the stored send's nonce", async () => {
    const world = chain();
    const { left } = await leftOpen(world, 1);
    world.approveLater({ to: OWNER, data: "0x" }, OWNER);

    const { run, sends } = await reopened(world, left);

    expect(progress(run)).toEqual({ stage: "halted", failure: { reason: "held", retryable: true }, holdsSend: true });
    expect(sends.prompts).toEqual([]);
  });

  it("stops as held, signing nothing, when another call to the same router took the stored send's nonce", async () => {
    const world = chain();
    const { left, hung } = await leftOpen(world, 1);
    const data = hung.data!;
    const other = `${data.slice(0, -1)}${data.endsWith("0") ? "1" : "0"}` as Hex;
    world.approveLater({ to: hung.to, data: other }, OWNER);

    const { run, sends } = await reopened(world, left);

    expect(progress(run)).toEqual({ stage: "halted", failure: { reason: "held", retryable: true }, holdsSend: true });
    expect(sends.prompts).toEqual([]);
  });

  it("signs nothing when Redeem is pressed on a held run in the same tab", async () => {
    const world = chain();
    const { left } = await leftOpen(world, 1);
    const { run, sends, storage } = await reopened(world, left);
    expect(progress(run).failure?.reason).toBe("held");

    run.start();
    await tick();

    expect(sends.prompts).toEqual([]);
    expect(progress(run).failure?.reason).toBe("held");
    expect(storedRun(storage)).not.toBeNull();
  });

  it("halts as reverted when the stored send mined and reverted", async () => {
    const world = chain();
    const { left, hung } = await leftOpen(world, 1);
    const landed = world.approveLater(hung, OWNER);

    const next = tab(world, { storage: left });
    next.reverted.add(landed.hash);
    next.run.recover();
    await vi.waitFor(() => expect(progress(next.run).stage).toBe("review"), { timeout: 3_000 });
    next.run.resume();
    await settled(next.run);

    expect(progress(next.run)).toEqual({ stage: "halted", failure: { reason: "reverted", retryable: false } });
    expect(next.sends.prompts).toEqual([]);
  });

  it("stops as pending, sending no second batch, while the stored batch has not landed", async () => {
    const world = chain();
    const first = tab(world, { atomic: true, sendCalls: "unmined" });
    first.run.start();
    await first.batch.sent();
    const left = copyStorage(first.storage);
    first.run.dispose();

    const { run, batch } = await reopened(world, left, { atomic: true });

    expect(progress(run)).toEqual({
      stage: "halted",
      failure: { reason: "pending", retryable: true },
      holdsSend: true,
    });
    expect(first.batch.sendCalls.length + batch.sendCalls.length).toBe(1);
  });

  it("goes to review, signing nothing, when Redeem is pressed on a stored run whose prompt may still be answered", async () => {
    const world = chain();
    const { left } = await leftOpen(world, 1);

    const next = tab(world, { storage: left });
    next.run.start();
    await settled(next.run);

    expect(progress(next.run).stage).toBe("review");
    expect(next.sends.prompts).toEqual([]);
  });
});

describe("createRedeemRun discard (L8)", () => {
  it("keeps the approve of a run held on its redeem, and resume asks for the redeem only, once", async () => {
    const world = chain();
    const { left, hung } = await leftOpen(world, 1);
    const { run, sends, storage } = await reopened(world, left);
    expect(progress(run)).toEqual({ stage: "halted", failure: { reason: "held", retryable: true }, holdsSend: true });

    await run.discard();

    expect(progress(run)).toEqual({ stage: "review" });
    expect(storedRun(storage)?.steps.map((step) => step.outcome.status)).toEqual(["confirmed", "pending"]);
    expect(sends.prompts).toEqual([]);
    run.resume();
    await vi.waitFor(() => expect(progress(run).stage).toBe("complete"), { timeout: 3_000 });
    sameCalls(sends.prompts, [hung]);
    expect(timesBroadcast(world, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("lets go of a held redeem whose nonce another transaction took, and resume signs the redeem once", async () => {
    const world = chain();
    const { left, hung } = await leftOpen(world, 1);
    world.approveLater({ to: OWNER, data: "0x" }, OWNER);
    const { run, sends } = await reopened(world, left);
    expect(progress(run).failure?.reason).toBe("held");

    await run.discard();
    expect(progress(run)).toEqual({ stage: "review" });
    run.resume();
    await vi.waitFor(() => expect(progress(run).stage).toBe("complete"), { timeout: 3_000 });

    sameCalls(sends.prompts, [hung]);
    expect(timesBroadcast(world, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("forgets a run held on its first prompt, and the next Redeem signs every call once", async () => {
    const world = chain();
    const { left } = await leftOpen(world, 0);
    const { run, sends, storage } = await reopened(world, left);
    expect(progress(run).failure?.reason).toBe("held");

    await run.discard();

    expect(progress(run)).toEqual({ stage: "idle" });
    expect(storedRun(storage)).toBeNull();
    expect(sends.prompts).toEqual([]);
    run.start();
    await vi.waitFor(() => expect(progress(run).stage).toBe("complete"), { timeout: 3_000 });
    sameCalls(sends.prompts, PLANNED);
  });

  it("keeps a held run whose prompt was approved and mined since it halted, and the retry signs nothing", async () => {
    const world = chain();
    const { left, hung } = await leftOpen(world, 1);
    const { run, sends, storage } = await reopened(world, left);
    expect(progress(run).failure?.reason).toBe("held");
    world.approveLater(hung, OWNER);

    await run.discard();

    expect(progress(run)).toEqual({
      stage: "halted",
      failure: { reason: "pending", retryable: true },
      holdsSend: true,
    });
    expect(storedRun(storage)).not.toBeNull();
    run.retry();
    await vi.waitFor(() => expect(progress(run).stage).toBe("complete"), { timeout: 3_000 });
    expect(sends.prompts).toEqual([]);
    expect(timesBroadcast(world, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("keeps a held run whose prompt was approved and is broadcast, not yet mined", async () => {
    const world = chain();
    const { left, hung } = await leftOpen(world, 1);
    const { run, sends, storage } = await reopened(world, left);
    world.broadcast(hung, OWNER, false);

    await run.discard();

    expect(progress(run).failure).toEqual({ reason: "pending", retryable: true });
    expect(storedRun(storage)).not.toBeNull();
    expect(sends.prompts).toEqual([]);
  });

  it("keeps another account's run", async () => {
    const world = chain();
    const { left } = await leftOpen(world, 1);
    const next = tab(world, { storage: left, account: OTHER });
    next.run.recover();
    expect(progress(next.run)).toEqual({ stage: "halted", failure: { reason: "wrong-wallet", retryable: true } });

    await next.run.discard();

    expect(storedRun(left)).not.toBeNull();
    expect(next.sends.prompts).toEqual([]);
  });

  it("keeps a run while the wallet is on another chain than the run's", async () => {
    const world = chain();
    const { left } = await leftOpen(world, 1);
    const next = tab(world, { storage: left, chainId: 1 });
    next.run.recover();
    expect(progress(next.run).failure?.reason).toBe("wrong-chain");

    await next.run.discard();

    expect(storedRun(left)).not.toBeNull();
  });

  it("atomic: keeps a run whose batch the wallet cannot report, and never sends it again (L9)", async () => {
    const world = chain();
    const first = tab(world, { atomic: true, sendCalls: "unmined" });
    first.run.start();
    await first.batch.sent();
    const left = copyStorage(first.storage);
    first.run.dispose();
    world.batches.clear();

    const { run, batch, storage } = await reopened(world, left, { atomic: true });
    expect(progress(run)).toEqual({
      stage: "halted",
      failure: { reason: "batch-unknown", retryable: false },
      holdsSend: true,
    });

    await run.discard();
    expect(progress(run).failure).toEqual({ reason: "batch-unknown", retryable: false });
    expect(storedRun(storage)).not.toBeNull();
    run.start();
    run.retry();
    await tick();

    expect(batch.sendCalls).toEqual([]);
    expect(storedRun(storage)).not.toBeNull();
  });
});

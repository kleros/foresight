import { createFlowRunStore, createMemoryStorage, type FlowRunStorage, type FlowTx } from "@foresight/tx-orchestrator";
import { decodeFunctionData, getAddress, isAddressEqual, parseAbi, type Address, type Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chain,
  copyStorage,
  gateway,
  rawStorage,
  timesBroadcast,
  wallet,
  type Chain,
  type PromptScript,
} from "./support/world";
import type { ChildResolution, ParentResolution } from "../../api/getSessionResolution";
import { planWalletRedeem, type TradeWalletRedeemInput } from "../plan";
import { createRedeemRun } from "../run";

/**
 * The API these tests hold `features/resolution/redeem/run.ts` to: the connected wallet's redeem, driven by the
 * tx-orchestrator flow runner as the liquidity driver is (`features/liquidity/run/driver.ts`).
 *
 *   createRedeemRun({
 *     gateway: BalanceTxGateway,          // one-by-one sends from the connected wallet
 *     wallet: { request({ method, params }) → Promise<unknown> },
 *                                         // EIP-1193: wallet_getCapabilities, wallet_sendCalls and
 *                                         // wallet_getCallsStatus (EIP-5792 v2, hex chain ids)
 *     reader: {
 *       nextNonce(account): Promise<number>;      hasPending(account): Promise<boolean>;
 *       blockNumber(): Promise<bigint>;           sentWithNonce({ owner, nonce, fromBlock }): Promise<SentWithNonce>;
 *       balanceOf(token, account): Promise<bigint>;
 *     },                                  // as LiquidityReader names them, plus an ERC-20 balance read
 *     store: FlowRunStore,
 *     flowId: string,
 *     account: () => Address | undefined,
 *     chainId: () => number,
 *     request: () => WalletRedeemInput,   // what the Redeem section showed, read when start() is pressed;
 *                                         // the run signs planWalletRedeem(request).calls
 *     now?: () => number,
 *     pollMs?: number,
 *   }) → {
 *     start(); recover(); resume(); retry(); dispose();
 *     getProgress(): { stage: "idle" | "signing" | "confirming" | "review" | "halted" | "complete";
 *                      failure?: { reason: string; retryable: boolean } };
 *     subscribe(listener) → unsubscribe;
 *   }
 *
 *   One atomic wallet_sendCalls (atomicRequired true) when wallet_getCapabilities reports atomic "supported" or
 *   "ready" for 0x64; otherwise one prompt per call. Each send, and a batch's id, is stored before the wallet is
 *   asked. recover() loads a stored run for review and signs nothing; resume() continues it. A rejected prompt halts
 *   the run as "rejected", retryable.
 */

const CHAIN_ID = 100;
const WAD = 10n ** 18n;
const at = (prefix: string): Address => getAddress(`0x${prefix.padEnd(40, "0")}`);

const OWNER: Address = "0x00000000000000000000000000000000000000a1";
const SDAI: Address = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
const PARENT = at("b0");
const childMarket = (index: number) => at(`c${index + 1}`);
const parentToken = (index: number) => at(`e0${index}`);
const childToken = (index: number, slot: number) => at(`d${index}${slot}`);

const REDEEM_ABI = parseAbi([
  "function redeemPositions(address,address,uint256[],uint256[])",
  "function redeemConditionalToCollateral(address,address,uint256[],uint256[],uint256[])",
]);
/** redeemPositions and redeemConditionalToCollateral, as `oracle/allowlist.ts` names them. */
const REDEEM_SELECTORS = ["0x865955a0", "0xc3eba97a"];

const PARENT_RESOLVED: ParentResolution = {
  resolved: true,
  invalid: false,
  winningOutcomes: [0, 1],
  payoutNumerators: [1n, 1n, 0n],
  payoutDenominator: 2n,
};
const valued = (index: number, value: bigint): ChildResolution => ({
  deployed: true,
  market: childMarket(index),
  resolved: true,
  invalid: false,
  finalValue: Number(value),
  payoutNumerators: [100n * WAD - value * WAD, value * WAD, 0n],
  payoutDenominator: 100n * WAD,
});

/** What an LP holds after Remove on a two-option session whose options both won and resolved: three parts. */
const BALANCES: Record<string, bigint> = {
  [parentToken(0)]: 3n * WAD + 11n,
  [parentToken(1)]: 2n * WAD - 5n,
  [parentToken(2)]: 0n,
  [childToken(0, 0)]: 4n * WAD - 1_234_567n,
  [childToken(0, 1)]: 1n * WAD + 7n,
  [childToken(0, 2)]: 0n,
  [childToken(1, 0)]: 2n * WAD,
  [childToken(1, 1)]: 5n * WAD - 3n,
  [childToken(1, 2)]: 0n,
};

const holding = (token: Address) => ({ token, balance: BALANCES[token]! });

const INPUT: TradeWalletRedeemInput = {
  chainId: CHAIN_ID,
  owner: OWNER,
  collateral: SDAI,
  parentMarket: PARENT,
  resolution: { parent: PARENT_RESOLVED, children: { 0: valued(0, 42n), 1: valued(1, 73n) } },
  parentTokens: [0, 1, 2].map((index) => holding(parentToken(index))),
  childTokens: {
    0: [0, 1, 2].map((slot) => holding(childToken(0, slot))),
    1: [0, 1, 2].map((slot) => holding(childToken(1, slot))),
  },
};

const isRedeem = (tx: { data?: Hex }) => REDEEM_SELECTORS.includes((tx.data ?? "0x").slice(0, 10).toLowerCase());

/** token → amount each redeem call of `calls` pulls. */
function pulled(calls: { to: Address; data?: Hex }[]): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const call of calls) {
    if (!isRedeem(call)) continue;
    const decoded = decodeFunctionData({ abi: REDEEM_ABI, data: call.data! });
    const market = decoded.args[1] as Address;
    const indexes = decoded.args[2] as readonly bigint[];
    const amounts = (
      decoded.functionName === "redeemPositions" ? decoded.args[3] : decoded.args[4]
    ) as readonly bigint[];
    indexes.forEach((index, slot) => {
      const token = isAddressEqual(market, PARENT)
        ? parentToken(Number(index))
        : childToken(isAddressEqual(market, childMarket(0)) ? 0 : 1, Number(index));
      out.set(token.toLowerCase(), (out.get(token.toLowerCase()) ?? 0n) + amounts[slot]!);
    });
  }
  return out;
}

// ---------------------------------------------------------------- a chain whose balances follow what mined

interface World {
  fake: Chain;
  wallets: ReturnType<typeof wallet>[];
}

/** The calls that mined from OWNER, one by one or inside an atomic batch. */
function minedCalls({ fake, wallets }: World) {
  const sequential = fake.broadcasts.filter((sent) => sent.mined && isAddressEqual(sent.from, OWNER));
  const batched = wallets.flatMap((each) =>
    each.sendCalls.flatMap((request) => (fake.batches.get(request.id ?? "")?.mined ? request.calls : [])),
  );
  return [...sequential.map((sent) => sent.tx), ...batched];
}

function readerOf(world: World) {
  return {
    ...world.fake.reader,
    balanceOf: (token: Address, account: Address) => {
      if (!isAddressEqual(account, OWNER)) return Promise.resolve(0n);
      const start = Object.entries(BALANCES).find(([each]) => isAddressEqual(each as Address, token))?.[1] ?? 0n;
      const spent = pulled(minedCalls(world)).get(token.toLowerCase()) ?? 0n;
      return Promise.resolve(start > spent ? start - spent : 0n);
    },
  };
}

type Run = ReturnType<typeof createRedeemRun>;
const runs: Run[] = [];
afterEach(() => {
  for (const run of runs.splice(0)) run.dispose();
});

function tab(
  world: World,
  opts: {
    script?: (index: number, tx: FlowTx) => PromptScript;
    atomic?: boolean;
    sendCalls?: "answer" | "unmined";
    sendCallsRefuse?: number;
    onSendCalls?: (params: { id?: string }) => void;
    storage?: FlowRunStorage;
  } = {},
) {
  const storage = opts.storage ?? createMemoryStorage();
  const sends = gateway(world.fake, OWNER, opts.script ? { script: opts.script } : {});
  const batch = wallet(world.fake, OWNER, {
    atomic: opts.atomic ?? false,
    ...(opts.sendCalls ? { sendCalls: opts.sendCalls } : {}),
    ...(opts.sendCallsRefuse === undefined ? {} : { sendCallsRefuse: opts.sendCallsRefuse }),
    ...(opts.onSendCalls ? { onSendCalls: opts.onSendCalls } : {}),
  });
  world.wallets.push(batch);
  const run = createRedeemRun({
    gateway: sends.port,
    wallet: batch.port,
    reader: readerOf(world),
    store: createFlowRunStore({ storage }),
    flowId: "redeem-session-4",
    account: () => OWNER,
    chainId: () => CHAIN_ID,
    request: () => INPUT,
    now: () => 1_700_000_000_000,
    pollMs: 5,
  });
  runs.push(run);
  return { run, sends, batch, storage };
}

const stageOf = (run: Run) => run.getProgress().stage;
const failureOf = (run: Run) => run.getProgress().failure;

const settled = (run: Run) =>
  vi.waitFor(() => expect(["complete", "halted", "review"]).toContain(stageOf(run)), { timeout: 3_000 });

/** A second tab on what the first left in storage, recovered and resumed until it rests. */
async function reopened(world: World, left: FlowRunStorage, opts: { atomic?: boolean } = {}) {
  const next = tab(world, { storage: left, ...opts });
  next.run.recover();
  await vi.waitFor(() => expect(stageOf(next.run)).toBe("review"), { timeout: 3_000 });
  next.run.resume();
  await settled(next.run);
  return next;
}

const callOf = (tx: { to: Address; data?: Hex; value?: bigint | Hex }) => ({
  to: tx.to.toLowerCase(),
  data: (tx.data ?? "0x").toLowerCase(),
});

let PLANNED: FlowTx[] = [];
let REDEEMS: FlowTx[] = [];
let FIRST_REDEEM = -1;
let SECOND_REDEEM = -1;
// Planned per test, so a planner that throws fails each test rather than the file's load.
beforeEach(() => {
  PLANNED = planWalletRedeem(INPUT).calls;
  REDEEMS = PLANNED.filter(isRedeem);
  FIRST_REDEEM = PLANNED.findIndex(isRedeem);
  SECOND_REDEEM = PLANNED.findIndex((tx, index) => index > FIRST_REDEEM && isRedeem(tx));
});

const newWorld = (): World => ({ fake: chain(), wallets: [] });

describe("createRedeemRun sends the planned calls from the connected wallet", () => {
  it("plans three parts here, so a run has calls before and after each redeem", () => {
    expect(REDEEMS.length).toBe(3);
    expect(FIRST_REDEEM).toBeGreaterThan(0);
    expect(SECOND_REDEEM).toBeGreaterThan(FIRST_REDEEM + 1);
  });

  it("asks for each call once, in order, when the wallet has no atomic batching", async () => {
    const world = newWorld();
    const { run, sends, batch } = tab(world);

    run.start();
    await settled(run);

    expect(stageOf(run)).toBe("complete");
    expect(sends.prompts.map(callOf)).toEqual(PLANNED.map(callOf));
    expect(batch.sendCalls).toEqual([]);
    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("asks for one atomic wallet_sendCalls holding every call when the wallet supports it", async () => {
    const world = newWorld();
    const { run, sends, batch } = tab(world, { atomic: true });

    run.start();
    await settled(run);

    expect(stageOf(run)).toBe("complete");
    expect(sends.prompts).toEqual([]);
    expect(batch.sendCalls).toHaveLength(1);
    const [request] = batch.sendCalls;
    expect(request!.atomicRequired).toBe(true);
    expect(request!.chainId.toLowerCase()).toBe("0x64");
    expect(request!.calls.map(callOf)).toEqual(PLANNED.map(callOf));
    for (const call of request!.calls) expect(BigInt(call.value ?? "0x0")).toBe(0n);
  });
});

describe("createRedeemRun A3 a reload mid-run resumes without a second redeem", () => {
  /** A one-by-one run whose prompt `stuck` was open, and never answered in that tab, when the tab closed. */
  async function leftOpen(stuck: number) {
    const world = newWorld();
    let storedBeforePrompt: boolean | undefined;
    const first = tab(world, {
      script: (index, tx) => {
        if (index !== stuck) return "sign";
        storedBeforePrompt = rawStorage(first.storage)
          .toLowerCase()
          .includes((tx.data ?? "0x").toLowerCase());
        return "hang";
      },
    });
    first.run.start();
    await first.sends.held();
    const left = copyStorage(first.storage);
    first.run.dispose();
    return { world, left, hung: first.sends.hung[0]!, storedBeforePrompt };
  }

  it("stores the send before the wallet opens", async () => {
    const { storedBeforePrompt } = await leftOpen(FIRST_REDEEM);

    expect(storedBeforePrompt).toBe(true);
  });

  it("finishes without signing the redeem again once its prompt was approved after the tab closed", async () => {
    const { world, left, hung } = await leftOpen(FIRST_REDEEM);
    world.fake.approveLater(hung, OWNER);

    const { run, sends } = await reopened(world, left);

    expect(stageOf(run)).toBe("complete");
    expect(sends.prompts.map(callOf)).toEqual(PLANNED.slice(FIRST_REDEEM + 1).map(callOf));
    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("finishes without signing a later redeem again once its prompt was approved after the tab closed", async () => {
    const { world, left, hung } = await leftOpen(SECOND_REDEEM);
    world.fake.approveLater(hung, OWNER);

    const { run, sends } = await reopened(world, left);

    expect(stageOf(run)).toBe("complete");
    expect(sends.prompts.map(callOf)).toEqual(PLANNED.slice(SECOND_REDEEM + 1).map(callOf));
    expect(timesBroadcast(world.fake, REDEEMS)).toEqual(REDEEMS.map(() => 1));
  });

  it("does not ask for a redeem again while its prompt from the closed tab may still be answered", async () => {
    const { world, left, hung } = await leftOpen(FIRST_REDEEM);

    const { sends } = await reopened(world, left);

    expect(sends.prompts.some((tx) => callOf(tx).data === callOf(hung).data)).toBe(false);
    expect(timesBroadcast(world.fake, REDEEMS).every((times) => times <= 1)).toBe(true);
  });

  it("stores the batch's id before the wallet opens, and never sends the batch again after a reload", async () => {
    const world = newWorld();
    let storedBeforePrompt: boolean | undefined;
    const first = tab(world, {
      atomic: true,
      sendCalls: "unmined",
      onSendCalls: ({ id }) => {
        storedBeforePrompt = id !== undefined && rawStorage(first.storage).includes(id);
      },
    });
    first.run.start();
    await first.batch.sent();
    const left = copyStorage(first.storage);
    first.run.dispose();
    world.fake.land();

    const { run, sends } = await reopened(world, left, { atomic: true });

    expect(storedBeforePrompt).toBe(true);
    expect(stageOf(run)).toBe("complete");
    expect(world.wallets.reduce((sum, each) => sum + each.sendCalls.length, 0)).toBe(1);
    expect(sends.prompts).toEqual([]);
  });
});

describe("createRedeemRun A3 a rejected signature leaves a retry that signs only what is left", () => {
  it("one by one: halts as rejected, and the retry asks for the rejected call and those after it only", async () => {
    const world = newWorld();
    let rejected = false;
    const { run, sends } = tab(world, {
      script: (index) => (index === SECOND_REDEEM && !rejected ? ((rejected = true), "reject") : "sign"),
    });

    run.start();
    await settled(run);

    expect(stageOf(run)).toBe("halted");
    expect(failureOf(run)).toEqual({ reason: "rejected", retryable: true });
    const beforeRetry = sends.prompts.length;
    expect(beforeRetry).toBe(SECOND_REDEEM + 1);

    run.retry();
    await vi.waitFor(() => expect(stageOf(run)).toBe("complete"), { timeout: 3_000 });

    expect(sends.prompts.slice(beforeRetry).map(callOf)).toEqual(PLANNED.slice(SECOND_REDEEM).map(callOf));
    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("one by one: a rejected first redeem leaves its own approve signed once", async () => {
    const world = newWorld();
    let rejected = false;
    const { run, sends } = tab(world, {
      script: (index) => (index === FIRST_REDEEM && !rejected ? ((rejected = true), "reject") : "sign"),
    });

    run.start();
    await settled(run);
    expect(failureOf(run)).toEqual({ reason: "rejected", retryable: true });
    const beforeRetry = sends.prompts.length;

    run.retry();
    await vi.waitFor(() => expect(stageOf(run)).toBe("complete"), { timeout: 3_000 });

    expect(sends.prompts.slice(beforeRetry).map(callOf)).toEqual(PLANNED.slice(FIRST_REDEEM).map(callOf));
    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("atomic: a rejected batch sent nothing, so the retry asks for the whole batch once more and it lands once", async () => {
    const world = newWorld();
    const { run, batch } = tab(world, { atomic: true, sendCallsRefuse: 4001 });

    run.start();
    await settled(run);
    expect(stageOf(run)).toBe("halted");
    expect(failureOf(run)).toEqual({ reason: "rejected", retryable: true });

    run.retry();
    await vi.waitFor(() => expect(stageOf(run)).toBe("complete"), { timeout: 3_000 });

    expect(batch.sendCalls).toHaveLength(2);
    expect(batch.sendCalls[1]!.calls.map(callOf)).toEqual(PLANNED.map(callOf));
    expect(world.fake.broadcasts.filter((sent) => sent.mined)).toHaveLength(1);
  });
});

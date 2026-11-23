import {
  createFlowRunStore,
  createMemoryStorage,
  type BalanceTxGateway,
  type FlowRunStorage,
  type FlowTx,
} from "@foresight/tx-orchestrator";
import { decodeFunctionData, getAddress, isAddressEqual, parseAbi, type Address, type Hash, type Hex } from "viem";
import { expect, vi } from "vitest";

import { chain, gateway, wallet, type Chain, type PromptScript, type SendCallsRequest } from "./world";
import type { ChildResolution, ParentResolution } from "../../../api/getSessionResolution";
import { planWalletRedeem, type WalletRedeemInput } from "../../plan";
import { createRedeemRun, type RedeemProgress, type RedeemReader } from "../../run";

/**
 * Tabs of the wallet redeem run over the frozen fakes in `world.ts`, with what those fakes cannot do: reverted
 * receipts, wallet answers by method, a storage that refuses writes, and balances that follow what mined.
 */

export const CHAIN_ID = 100;
const WAD = 10n ** 18n;
const at = (prefix: string): Address => getAddress(`0x${prefix.padEnd(40, "0")}`);

export const OWNER: Address = "0x00000000000000000000000000000000000000a1";
export const OTHER: Address = "0x00000000000000000000000000000000000000b2";
const SDAI: Address = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
const PARENT = at("b0");
const childMarket = (index: number) => at(`c${index + 1}`);
export const parentToken = (index: number) => at(`e0${index}`);
export const childToken = (index: number, slot: number) => at(`d${index}${slot}`);

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

/** Two options that both won and resolved: three parts, the parent's and each child's, each of two tokens. */
export const BALANCES: Record<string, bigint> = {
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

export const INPUT: WalletRedeemInput = {
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

export const PLANNED: FlowTx[] = planWalletRedeem(INPUT).calls;
const REDEEM_SELECTORS = ["0x865955a0", "0xc3eba97a"];
export const isRedeem = (tx: { data?: Hex }) => REDEEM_SELECTORS.includes((tx.data ?? "0x").slice(0, 10).toLowerCase());
/** Indexes into PLANNED: approve A, approve B, redeem, for each of the three parts. */
export const REDEEM_AT = PLANNED.flatMap((tx, index) => (isRedeem(tx) ? [index] : []));

const REDEEM_ABI = parseAbi([
  "function redeemPositions(address,address,uint256[],uint256[])",
  "function redeemConditionalToCollateral(address,address,uint256[],uint256[],uint256[])",
]);

/** token → amount the redeem calls of `calls` pull. */
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

export interface World {
  fake: Chain;
  wallets: ReturnType<typeof wallet>[];
  /** Hashes whose receipt reads reverted. */
  reverts: Set<Hash>;
  /** Added to a token's balance, as a transfer in would. */
  extra: Map<string, bigint>;
}

export const newWorld = (): World => ({ fake: chain(), wallets: [], reverts: new Set(), extra: new Map() });

/** The calls that mined from OWNER and did not revert, one by one or inside an atomic batch. */
function minedCalls({ fake, wallets, reverts }: World) {
  const sequential = fake.broadcasts.filter(
    (sent) => sent.mined && !reverts.has(sent.hash) && isAddressEqual(sent.from, OWNER),
  );
  const batched = wallets.flatMap((each) =>
    each.sendCalls.flatMap((request) => (fake.batches.get(request.id ?? "")?.mined ? request.calls : [])),
  );
  return [...sequential.map((sent) => sent.tx), ...batched];
}

export function readerOf(world: World): RedeemReader {
  return {
    ...world.fake.reader,
    balanceOf: (token, account) => {
      if (!isAddressEqual(account, OWNER)) return Promise.resolve(0n);
      const key = token.toLowerCase();
      const start = Object.entries(BALANCES).find(([each]) => isAddressEqual(each as Address, token))?.[1] ?? 0n;
      const spent = pulled(minedCalls(world)).get(key) ?? 0n;
      return Promise.resolve((start > spent ? start - spent : 0n) + (world.extra.get(key) ?? 0n));
    },
  };
}

/** A storage that throws on a write containing `refusing.text` while `refusing.on` is set, as a full quota does. */
export function refusingStorage(text: string) {
  const inner = createMemoryStorage();
  const refusing = { on: true, text, refused: 0 };
  const storage: FlowRunStorage = {
    ...inner,
    setItem: (key, value) => {
      if (refusing.on && value.includes(refusing.text)) {
        refusing.refused += 1;
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      inner.setItem(key, value);
    },
  };
  return { storage, refusing };
}

type Run = ReturnType<typeof createRedeemRun>;
export const runs: Run[] = [];

export interface TabOptions {
  /** `unmined`: the prompt is approved and its send broadcast, which mines on `land()`. */
  script?: (index: number, tx: FlowTx) => PromptScript | "unmined";
  atomic?: boolean;
  sendCalls?: "answer" | "unmined";
  sendCallsRefuse?: number;
  onSendCalls?: (params: SendCallsRequest) => void;
  storage?: FlowRunStorage;
  account?: Address;
  chainId?: number;
  /** Answers a wallet method before the fake does; `undefined` passes it on. */
  answer?: (method: string, params: unknown) => Promise<unknown> | undefined;
  /** Throws instead of the n-th one-by-one prompt (from 0) opening. */
  sendError?: (index: number) => unknown;
  reader?: Partial<RedeemReader>;
  ttlMs?: number;
  storeNow?: () => number;
  withLock?: (work: () => Promise<void>, signal: AbortSignal) => Promise<void>;
}

export function tab(world: World, opts: TabOptions = {}) {
  const storage = opts.storage ?? createMemoryStorage();
  let decided: PromptScript = "sign";
  const sends = gateway(world.fake, OWNER, { script: () => decided });
  const batch = wallet(world.fake, OWNER, {
    atomic: opts.atomic ?? false,
    ...(opts.sendCalls ? { sendCalls: opts.sendCalls } : {}),
    ...(opts.sendCallsRefuse === undefined ? {} : { sendCallsRefuse: opts.sendCallsRefuse }),
    ...(opts.onSendCalls ? { onSendCalls: opts.onSendCalls } : {}),
  });
  world.wallets.push(batch);
  let attempts = 0;
  const port: BalanceTxGateway = {
    ...sends.port,
    sendTransaction: (tx, options) => {
      const error = opts.sendError?.(attempts++);
      if (error !== undefined) return Promise.reject(error);
      const step = opts.script?.(sends.prompts.length, tx) ?? "sign";
      if (step === "unmined") {
        sends.prompts.push(tx);
        return Promise.resolve(world.fake.broadcast(tx, OWNER, false).hash);
      }
      decided = step;
      return sends.port.sendTransaction(tx, options);
    },
    waitForReceipt: async (args) => {
      const receipt = await sends.port.waitForReceipt(args);
      return world.reverts.has(receipt.transactionHash) ? { ...receipt, status: "reverted" } : receipt;
    },
    getReceipt: async (hash) => {
      const receipt = await sends.port.getReceipt(hash);
      return receipt && world.reverts.has(hash) ? { ...receipt, status: "reverted" } : receipt;
    },
  };
  const requests: { method: string; params?: unknown }[] = [];
  const run = createRedeemRun({
    gateway: port,
    wallet: {
      request: async (args) => {
        requests.push(args);
        const answered = opts.answer?.(args.method, args.params);
        return answered === undefined ? batch.port.request(args) : answered;
      },
    },
    reader: { ...readerOf(world), ...opts.reader },
    store: createFlowRunStore({
      storage,
      ...(opts.ttlMs === undefined ? {} : { ttlMs: opts.ttlMs }),
      ...(opts.storeNow ? { now: opts.storeNow } : {}),
    }),
    flowId: "redeem-session-4",
    account: () => ("account" in opts ? opts.account : OWNER),
    chainId: () => opts.chainId ?? CHAIN_ID,
    request: () => INPUT,
    now: () => 1_700_000_000_000,
    pollMs: 5,
    ...(opts.withLock ? { withLock: opts.withLock } : {}),
  });
  runs.push(run);
  return { run, sends, batch, storage, requests };
}

export const progress = (run: Run): RedeemProgress => run.getProgress();

export const settled = (run: Run) =>
  vi.waitFor(() => expect(["complete", "halted", "review"]).toContain(run.getProgress().stage), { timeout: 3_000 });

export const reached = (run: Run, stage: RedeemProgress["stage"]) =>
  vi.waitFor(() => expect(run.getProgress().stage).toBe(stage), { timeout: 3_000 });

/** A tab on `storage`, recovered until it rests for review or halts. */
export async function recovered(world: World, storage: FlowRunStorage, opts: TabOptions = {}) {
  const next = tab(world, { ...opts, storage });
  next.run.recover();
  await settled(next.run);
  return next;
}

export const callOf = (tx: { to: Address; data?: Hex }) => ({
  to: tx.to.toLowerCase(),
  data: (tx.data ?? "0x").toLowerCase(),
});

/** The stored run's snapshot sends and batch id, read as raw JSON. */
export function stored(storage: FlowRunStorage) {
  const raw = storage.keys().map((key) => storage.getItem(key)!);
  if (raw.length === 0) return null;
  const record = JSON.parse(raw[0]!) as { snapshot: { sends: Record<string, unknown>; callsId?: string } };
  return { sends: Object.keys(record.snapshot.sends).sort(), callsId: record.snapshot.callsId };
}

export const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

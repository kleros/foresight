import {
  createFlowRunStore,
  createMemoryStorage,
  type BalanceTxGateway,
  type FlowRunStorage,
  type FlowRunStore,
  type FlowTx,
  type PersistedFlowRun,
} from "@foresight/tx-orchestrator";
import {
  isAddressEqual,
  numberToHex,
  UserRejectedRequestError,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { expect, vi } from "vitest";

import { decode, owner } from "../../../flow/__tests__/support/session";
import type { LiquiditySession, MergeInput, PoolState, RemoveInput, SeedInput, SentWithNonce } from "../../../types";
import { createLiquidityRun } from "../../driver";

/**
 * Fakes for the liquidity run driver tests, and the API these tests hold `run/driver.ts` to:
 *
 *   createLiquidityRun({
 *     gateway: BalanceTxGateway,          // sequential sends, through the tx-orchestrator under adapter "liquidity-flow"
 *     wallet: { request({ method, params }) → Promise<unknown> },
 *                                         // the connected wallet's EIP-1193 provider: wallet_getCapabilities,
 *                                         // wallet_sendCalls and wallet_getCallsStatus (EIP-5792 v2, hex chain ids)
 *     reader: LiquidityReader,            // below
 *     store: FlowRunStore,
 *     flowId: string,
 *     account: () => Address | undefined, // the connected account; undefined when none is connected
 *     chainId: () => number,              // the connected chain
 *     request: () => LiquidityRequest,    // what the popup reviewed, read when start() is pressed
 *     closesAt: bigint,                   // the session's close, in chain seconds
 *     now?: () => number,                 // the browser clock, in ms
 *     pollMs?: number,                    // how often a sent batch's status is asked
 *   }) → LiquidityDriver
 *
 *   LiquidityRequest =
 *     | { kind: "seed"; input: SeedInput }        // seed or add: input.branches[].pools is the reviewed pool state
 *     | { kind: "remove"; session: LiquiditySession; input: RemoveInput }   // input.sqrtPriceX96 is the reviewed price
 *     | { kind: "merge"; input: MergeInput }
 *
 *   LiquidityReader {
 *     chainTime(): Promise<bigint>                          // the latest block's timestamp, seconds
 *     pool(tokenA: Address, tokenB: Address): Promise<PoolState>   // the pair's pool, tokens in either order
 *     ownerOf(tokenId: bigint): Promise<Address>
 *     nextNonce(account: Address): Promise<number>          // the account's next nonce, counting mined sends only
 *     hasPending(account: Address): Promise<boolean>        // a send of the account is broadcast and not yet mined
 *     blockNumber(): Promise<bigint>                        // the latest block's number
 *     sentWithNonce({ owner, nonce, fromBlock }): Promise<SentWithNonce>   // what took that nonce, from that block on
 *   }
 *
 *   LiquidityDriver { start(); recover(); resume(); retry(); reset(); discard(); dispose();
 *                     getProgress(): LiquidityProgress; subscribe(listener) → unsubscribe }
 *     recover() loads a stored run for review (stage "review") and signs nothing; resume() continues it.
 *
 *   LiquidityProgress {
 *     stage: "idle" | "signing" | "confirming" | "review" | "moved" | "halted" | "complete";
 *     failure?: { reason: string; retryable: boolean };
 *     kind?: "seed" | "remove" | "merge";  tokenId?: bigint;  atomic?: true;   // tokenId: a remove's position
 *     rows: { id; view: "idle" | "running" | "done" | "failed"; signatures: { done; total } }[];
 *     signatures: { done; total };   // one per transaction, or one for a batch
 *     signature?: { position; total; status: "building" | "awaiting-signature" | "submitted" };
 *   }
 *     signature.status: "building" until the wallet is asked, "submitted" once it answered (a batch: before it lands).
 *     rows: a seed's "parent" then "branch:<i>", a remove's "remove", a merge's "branch:<i>" merges then "parent".
 *     stage "moved": a pool read at build differs from the reviewed one; nothing more is signed until a new review.
 *     reasons these tests name: "unlisted" (flow/allowed.ts found a departure, including a run whose owner is not
 *     the connected account), "closed" (seed or add at or after the close by chain time), "wrong-wallet"
 *     (a recovered run belongs to another account than the connected one, or none is connected).
 *
 *   Atomic path: when wallet_getCapabilities reports atomic "supported" or "ready" for 0x64, the run is one
 *   wallet_sendCalls whose params[0] carries an app-chosen `id` (stored before the request) and atomicRequired true.
 *   A run whose batch status the wallet cannot report is never sent again.
 */

export interface LiquidityProgressLike {
  stage: string;
  failure?: { reason: string; retryable: boolean };
}

export type LiquidityRequestLike =
  | { kind: "seed"; input: SeedInput }
  | { kind: "remove"; session: LiquiditySession; input: RemoveInput }
  | { kind: "merge"; input: MergeInput };

export type LiquidityDriverLike = ReturnType<typeof createLiquidityRun>;

/**
 * What the wallet does with the n-th prompt (from 0): mine it, refuse it, never answer, broadcast it unmined, mine it
 * reverted, or broadcast it and then cancel it with a self-send at its nonce.
 */
export type PromptScript = "sign" | "reject" | "hang" | "unmined" | "revert" | "cancel";

/** EIP-5792's atomic capability status, or no `atomic` entry at all. */
export type AtomicStatus = "supported" | "ready" | "unsupported" | "absent";

/** What wallet_getCallsStatus answers: confirmed (200), still pending (100), or an error naming no such batch. */
export type BatchStatusScript = "confirmed" | "pending" | "unknown";

const BLOCK_HASH: Hash = `0x${"b".repeat(64)}`;
const hashAt = (index: number): Hash => `0x${(index + 1).toString(16).padStart(64, "0")}`;
const pairKey = (a: Address, b: Address) => (BigInt(a) < BigInt(b) ? `${a}|${b}` : `${b}|${a}`).toLowerCase();

/** One broadcast transaction, by whoever sent it, whether a driver or a prompt approved after its tab closed. */
export interface Broadcast {
  hash: Hash;
  tx: FlowTx;
  from: Address;
  /** The sender's nonce, taken in broadcast order. */
  nonce: number;
  mined: boolean;
  /** The block that mined it. */
  minedIn?: bigint;
  reverted: boolean;
  /** Another transaction took its nonce, so it never mines. */
  dropped: boolean;
}

/** The logs a mined transaction's receipt carries, given the receipt's own fields. */
export type LogsOf = (
  sent: Broadcast,
  receipt: Pick<TransactionReceipt, "blockHash" | "blockNumber" | "transactionHash">,
) => TransactionReceipt["logs"];

/**
 * A Gnosis chain and the wallets on it, shared by every driver of a test so a reload sees what the last tab left.
 * Every field the receipt type names is filled, so a viem rename fails to compile here.
 */
export function chain(opts: { chainTime?: bigint; pools?: [Address, Address, PoolState][]; logs?: LogsOf } = {}) {
  const state = {
    chainTime: opts.chainTime ?? 1_900_000_000n,
    /** Every account's native balance, in wei; sends do not spend it. */
    native: 10n ** 30n,
    /** What the gateway estimates any send's gas to cost, in wei. */
    fee: 0n,
    block: 19_000_000n,
    pools: new Map<string, PoolState>((opts.pools ?? []).map(([a, b, pool]) => [pairKey(a, b), pool])),
    owners: new Map<bigint, Address>(),
  };
  const broadcasts: Broadcast[] = [];
  /** Atomic batches by the id they were sent under, so a reloaded tab's wallet can report on them. */
  const batches = new Map<string, Broadcast>();
  const waiting = new Map<Hash, (receipt: TransactionReceipt) => void>();

  const receiptOf = (sent: Broadcast): TransactionReceipt => {
    const ids = { blockHash: BLOCK_HASH, blockNumber: sent.minedIn ?? state.block, transactionHash: sent.hash };
    return {
      ...ids,
      contractAddress: null,
      cumulativeGasUsed: 21_000n,
      effectiveGasPrice: 1n,
      from: sent.from,
      gasUsed: 21_000n,
      logs: sent.reverted ? [] : (opts.logs?.(sent, ids) ?? []),
      logsBloom: `0x${"0".repeat(512)}`,
      status: sent.reverted ? "reverted" : "success",
      to: sent.tx.to,
      transactionIndex: 0,
      type: "eip1559",
    };
  };

  const ofAccount = (account: Address) =>
    broadcasts.filter((sent) => !sent.dropped && isAddressEqual(sent.from, account));

  function broadcast(tx: FlowTx, from: Address, mined: boolean, how: { reverted?: boolean } = {}): Broadcast {
    const sent: Broadcast = {
      hash: hashAt(broadcasts.length),
      tx,
      from,
      nonce: ofAccount(from).length,
      mined: false,
      reverted: how.reverted ?? false,
      dropped: false,
    };
    broadcasts.push(sent);
    if (mined) mine(sent);
    return sent;
  }

  function mine(sent: Broadcast) {
    if (sent.mined || sent.dropped) return;
    sent.mined = true;
    state.block += 1n;
    sent.minedIn = state.block;
    waiting.get(sent.hash)?.(receiptOf(sent));
    waiting.delete(sent.hash);
  }

  /** Mines a zero-value self-send at `sent`'s nonce, so `sent` never mines: a cancel from the wallet. */
  function cancel(sent: Broadcast): Broadcast {
    sent.dropped = true;
    const by: Broadcast = {
      hash: hashAt(broadcasts.length),
      tx: { to: sent.from, data: "0x", value: 0n },
      from: sent.from,
      nonce: sent.nonce,
      mined: false,
      reverted: false,
      dropped: false,
    };
    broadcasts.push(by);
    mine(by);
    return by;
  }

  const find = (hash: Hash) => broadcasts.find((sent) => sent.hash === hash);

  const reader = {
    chainTime: () => Promise.resolve(state.chainTime),
    pool: (tokenA: Address, tokenB: Address): Promise<PoolState> =>
      Promise.resolve(state.pools.get(pairKey(tokenA, tokenB)) ?? { status: "missing" }),
    ownerOf: (tokenId: bigint): Promise<Address> => {
      const holder = state.owners.get(tokenId);
      return holder ? Promise.resolve(holder) : Promise.reject(new Error(`no token ${tokenId}`));
    },
    nextNonce: (account: Address) => Promise.resolve(ofAccount(account).filter((sent) => sent.mined).length),
    hasPending: (account: Address) => Promise.resolve(ofAccount(account).some((sent) => !sent.mined)),
    blockNumber: () => Promise.resolve(state.block),
    sentWithNonce: ({ owner: account, nonce, fromBlock }: { owner: Address; nonce: number; fromBlock: bigint }) => {
      const sent = ofAccount(account).find((each) => each.nonce === nonce);
      const found: SentWithNonce = !sent
        ? { status: "none" }
        : !sent.mined
          ? { status: "pending" }
          : sent.minedIn! < fromBlock
            ? { status: "taken" }
            : {
                status: "mined",
                hash: sent.hash,
                to: sent.tx.to,
                input: sent.tx.data ?? "0x",
                value: sent.tx.value ?? 0n,
              };
      return Promise.resolve(found);
    },
  };

  return {
    state,
    reader,
    broadcasts,
    batches,
    setPool: (tokenA: Address, tokenB: Address, pool: PoolState) => state.pools.set(pairKey(tokenA, tokenB), pool),
    /** Broadcasts and mines `tx` outside any driver: a prompt the visitor approved after its tab closed. */
    approveLater: (tx: FlowTx, from: Address) => broadcast(tx, from, true),
    /** Mines every broadcast transaction still waiting. */
    land: () => broadcasts.forEach(mine),
    broadcast,
    cancel,
    find,
    receiptOf,
    waitFor: (hash: Hash) =>
      new Promise<TransactionReceipt>((resolve) => {
        const sent = find(hash);
        if (sent?.mined) resolve(receiptOf(sent));
        else waiting.set(hash, resolve);
      }),
  };
}

export type Chain = ReturnType<typeof chain>;

/**
 * The connected wallet's sequential door. `script(n, tx)` decides the n-th prompt; `onBroadcast` runs after a send
 * is broadcast, before its receipt is read, so a test can move the chain between two steps.
 */
export function gateway(
  world: Chain,
  from: Address,
  opts: { script?: (index: number, tx: FlowTx) => PromptScript; onBroadcast?: (tx: FlowTx) => void } = {},
) {
  const prompts: FlowTx[] = [];
  const hung: FlowTx[] = [];
  let onHang: (() => void) | undefined;
  /** Sends a cancel took the nonce of, by hash, and the cancel that did. */
  const cancelled = new Map<Hash, Broadcast>();

  const port: BalanceTxGateway = {
    sendTransaction: (tx) => {
      const index = prompts.length;
      prompts.push(tx);
      const step = opts.script?.(index, tx) ?? "sign";
      if (step === "reject")
        return Promise.reject(new UserRejectedRequestError(new Error("User rejected the request.")));
      if (step === "hang") {
        hung.push(tx);
        onHang?.();
        return new Promise<Hash>(() => {});
      }
      const sent = world.broadcast(tx, from, step === "sign" || step === "revert", { reverted: step === "revert" });
      if (step === "cancel") cancelled.set(sent.hash, world.cancel(sent));
      opts.onBroadcast?.(tx);
      return Promise.resolve(sent.hash);
    },
    waitForReceipt: ({ hash, onReplaced }) => {
      const by = cancelled.get(hash);
      if (!by) return world.waitFor(hash);
      onReplaced?.({ reason: "cancelled", hash: by.hash });
      return world.waitFor(by.hash);
    },
    getReceipt: (hash) => {
      const sent = world.find(hash);
      return Promise.resolve(sent?.mined ? world.receiptOf(sent) : null);
    },
    isKnown: (hash) => Promise.resolve(Boolean(world.find(hash) && !world.find(hash)!.dropped)),
    getBalance: () => Promise.resolve(world.state.native),
    estimateFee: () => Promise.resolve(world.state.fee),
  };

  return {
    port,
    prompts,
    hung,
    /** Resolves once a prompt is held open. */
    held: () => new Promise<void>((resolve) => (hung.length > 0 ? resolve() : (onHang = resolve))),
  };
}

/**
 * A raw EIP-1193 provider answering the three EIP-5792 methods. No library builds a wallet's side of these, so the
 * shapes follow the EIP: capabilities keyed by hex chain id, call values as hex quantities, status codes 100 and 200.
 */
export function wallet(
  world: Chain,
  from: Address,
  opts: {
    atomic?: AtomicStatus | ((chainId: Hex) => AtomicStatus);
    capabilitiesThrow?: boolean;
    capabilityChain?: Hex;
    /** `unmined`: the wallet answers and broadcasts the batch, which mines on `land()`. */
    sendCalls?: "answer" | "hang" | "unmined";
    status?: BatchStatusScript;
    onSendCalls?: (params: SendCallsRequest) => void;
  } = {},
) {
  const requests: { method: string; params?: unknown }[] = [];
  const sendCalls: SendCallsRequest[] = [];
  let onSend: (() => void) | undefined;

  const request = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
    requests.push({ method, params });
    switch (method) {
      case "eth_chainId":
        return "0x64";
      case "eth_accounts":
      case "eth_requestAccounts":
        return [from];
      case "wallet_getCapabilities": {
        if (opts.capabilitiesThrow) throw Object.assign(new Error("Method not supported"), { code: 4200 });
        const chainId = opts.capabilityChain ?? "0x64";
        const atomic = typeof opts.atomic === "function" ? opts.atomic(chainId) : (opts.atomic ?? "absent");
        return { [chainId]: atomic === "absent" ? {} : { atomic: { status: atomic } } };
      }
      case "wallet_sendCalls": {
        const [call] = params as [SendCallsRequest];
        sendCalls.push(call);
        opts.onSendCalls?.(call);
        onSend?.();
        if (opts.sendCalls === "hang") return new Promise(() => {});
        // an atomic batch lands as one transaction
        const mined = opts.sendCalls !== "unmined" && (opts.status ?? "confirmed") === "confirmed";
        const sent = world.broadcast({ to: from, data: "0x" }, from, mined);
        world.batches.set(call.id ?? "", sent);
        return { id: call.id };
      }
      case "wallet_getCallsStatus": {
        const [id] = params as [string];
        const status = opts.status ?? "confirmed";
        if (status === "unknown") throw Object.assign(new Error("Unknown bundle id"), { code: 5730 });
        const sent = world.batches.get(id);
        if (status === "pending" || !sent?.mined) {
          return { version: "2.0.0", id, chainId: "0x64", status: 100, atomic: true };
        }
        return {
          version: "2.0.0",
          id,
          chainId: "0x64",
          status: 200,
          atomic: true,
          receipts: [
            {
              logs: [],
              status: "0x1",
              blockHash: BLOCK_HASH,
              blockNumber: numberToHex(world.state.block),
              gasUsed: "0x5208",
              transactionHash: sent.hash,
            },
          ],
        };
      }
      default:
        throw Object.assign(new Error(`The fake wallet does not answer ${method}`), { code: 4200 });
    }
  };

  return {
    port: { request },
    requests,
    sendCalls,
    sent: () => new Promise<void>((resolve) => (sendCalls.length > 0 ? resolve() : (onSend = resolve))),
  };
}

export interface SendCallsRequest {
  version?: string;
  id?: string;
  chainId: Hex;
  from?: Address;
  atomicRequired: boolean;
  calls: { to: Address; data?: Hex; value?: Hex }[];
}

// ---------------------------------------------------------------- driver

const drivers: LiquidityDriverLike[] = [];

/** Disposes every driver a test made; call it from afterEach. */
export const disposeDrivers = () => {
  for (const driver of drivers.splice(0)) driver.dispose();
};

export const CLOSES_AT = 2_000_000_000n;

export function driverOn(args: {
  world: Chain;
  gateway: ReturnType<typeof gateway>;
  wallet: ReturnType<typeof wallet>;
  request: LiquidityRequestLike;
  storage?: FlowRunStorage;
  account?: () => Address | undefined;
  flowId?: string;
  closesAt?: bigint;
  now?: () => number;
  chainId?: () => number;
}) {
  const storage = args.storage ?? createMemoryStorage();
  const store = createFlowRunStore({ storage });
  const flowId = args.flowId ?? "liquidity-session-1";
  const driver = createLiquidityRun({
    gateway: args.gateway.port,
    wallet: args.wallet.port,
    reader: args.world.reader,
    store,
    flowId,
    account: args.account ?? (() => owner),
    chainId: args.chainId ?? (() => 100),
    request: () => args.request,
    closesAt: args.closesAt ?? CLOSES_AT,
    now: args.now ?? (() => 1_700_000_000_000),
    pollMs: 5,
  });
  drivers.push(driver);
  return { driver, store, storage, flowId };
}

export function copyStorage(from: FlowRunStorage): FlowRunStorage {
  const copy = createMemoryStorage();
  for (const key of from.keys()) copy.setItem(key, from.getItem(key)!);
  return copy;
}

/** Every stored byte, for checking that a value reached storage without knowing where the driver keeps it. */
export const rawStorage = (storage: FlowRunStorage) =>
  storage
    .keys()
    .map((key) => storage.getItem(key) ?? "")
    .join("\n");

export const storedRun = (store: FlowRunStore, flowId: string): PersistedFlowRun<unknown, unknown> | null =>
  store.load<unknown, unknown>(flowId);

/** Stored steps that hold a send: asked of the wallet, broadcast, or mined. */
export const storedSends = (store: FlowRunStore, flowId: string) =>
  (storedRun(store, flowId)?.steps ?? []).filter(
    (step) => step.outcome.status !== "pending" && step.outcome.status !== "skipped",
  );

export const settled = (driver: LiquidityDriverLike) =>
  vi.waitFor(
    () =>
      expect(["complete", "halted", "moved", "review"]).toContain(
        (driver.getProgress() as LiquidityProgressLike).stage,
      ),
    { timeout: 3_000 },
  );

/** The run's stage and failure only; driver.progress.test.ts reads the rows. */
export const progressOf = (driver: LiquidityDriverLike): LiquidityProgressLike => {
  const { stage, failure } = driver.getProgress();
  return failure ? { stage, failure } : { stage };
};

// ---------------------------------------------------------------- what reached the chain

export const sameTx = (a: FlowTx, b: FlowTx) =>
  isAddressEqual(a.to, b.to) && (a.data ?? "0x") === (b.data ?? "0x") && (a.value ?? 0n) === (b.value ?? 0n);

/** The call as a wallet is asked for it: target, calldata, native value. */
export const callOf = (tx: FlowTx) => ({ to: tx.to.toLowerCase(), data: tx.data ?? "0x", value: tx.value ?? 0n });

/** A split, mint, withdrawal or merge: the sends L8 holds to at most once per run. */
export function movesMoney(tx: FlowTx): boolean {
  const decoded = decode(tx);
  if (decoded.kind === "split" || decoded.kind === "splitFromBase" || decoded.kind === "merge") return true;
  return (
    decoded.kind === "multicall" &&
    decoded.inner.some((call) => call.name === "mint" || call.name === "decreaseLiquidity")
  );
}

/** How many times each of `txs` reached the chain, mined or still broadcast. */
export const timesBroadcast = (world: Chain, txs: readonly FlowTx[]) =>
  txs.map((tx) => world.broadcasts.filter((sent) => sameTx(sent.tx, tx)).length);

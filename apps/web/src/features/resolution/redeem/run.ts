"use client";

import {
  classifyTxError,
  createTxOrchestrator,
  currentEntry,
  isUserRejection,
  StorageWriteError,
  type BalanceTxGateway,
  type FlowRunStore,
  type FlowTx,
  type PersistedFlowRun,
  type TxErrorCause,
  type TxGateway,
  type TxStep,
} from "@foresight/tx-orchestrator";
import {
  bytesToHex,
  decodeFunctionData,
  erc20Abi,
  isAddressEqual,
  numberToHex,
  slice,
  type Address,
  type Hash,
  type Hex,
} from "viem";

import { planWalletRedeem, type WalletRedeemInput } from "./plan";
import { redeemCallsDepartures, type RedeemScope } from "./tradeWalletBatchAllowed";

export const BATCH = "batch";

/** EIP-5792's error for a batch id the wallet does not know. */
const UNKNOWN_BUNDLE = 5730;

const APPROVE_SELECTOR = "0x095ea7b3";

export type RedeemFailureReason =
  | TxErrorCause
  /** A call departs from the redeem allow-list (R8), so nothing was sent. */
  | "unlisted"
  /** A balance the run redeems differs from the one shown at review (R6); nothing more is signed. */
  | "changed"
  /** The run belongs to another account than the connected one, or none is connected. */
  | "wrong-wallet"
  | "wrong-chain"
  /** The account has a send not yet mined, or a sent batch is not yet confirmed. */
  | "pending"
  /** A call was asked of the wallet and the chain shows no send of it; it is never asked for again. */
  | "held"
  /** The wallet answered with an error that leaves no prompt open, so the call can be asked again. */
  | "wallet"
  | "storage"
  /** The wallet cannot report a sent batch, so it is never sent again. */
  | "batch-unknown"
  /** The wallet reports the batch did not land. */
  | "batch-failed";

export interface RedeemProgress {
  stage: "idle" | "signing" | "confirming" | "review" | "halted" | "complete";
  failure?: { reason: RedeemFailureReason; retryable: boolean };
}

export type SentWithNonce =
  | { status: "mined"; hash: Hash; to: Address; input: Hex; value: bigint }
  | { status: "pending" }
  | { status: "none" }
  | { status: "taken" };

export interface RedeemReader {
  nextNonce(account: Address): Promise<number>;
  hasPending(account: Address): Promise<boolean>;
  blockNumber(): Promise<bigint>;
  sentWithNonce(args: { owner: Address; nonce: number; fromBlock: bigint }): Promise<SentWithNonce>;
  balanceOf(token: Address, account: Address): Promise<bigint>;
}

/** EIP-1193: the connected wallet's provider. */
export interface RedeemWallet {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}

export interface RedeemRun {
  start(): void;
  recover(): void;
  resume(): void;
  retry(): void;
  dispose(): void;
  getProgress(): RedeemProgress;
  subscribe(listener: () => void): () => void;
}

/** A send asked of the wallet: the call, the account's next nonce, and the head block before. */
interface SendRecord {
  tx: FlowTx;
  nonce: number;
  fromBlock: bigint;
}

export interface RedeemSnapshot {
  /** What the Redeem section showed; every build re-plans from it. */
  request: WalletRedeemInput;
  atomic: boolean;
  sends: Record<string, SendRecord>;
  /** The id of the batch asked of the wallet; while set, the batch is never asked for again. */
  callsId?: string;
}

interface RedeemCtx {
  owner: Address;
  chainId: number;
}

interface CallsStatus {
  status: number;
  receipts?: { transactionHash: Hash }[];
}

/** Why the run stopped, which the orchestrator's own causes cannot carry. */
class RunStop extends Error {
  constructor(
    readonly reason: RedeemFailureReason,
    readonly retryable: boolean,
  ) {
    super(reason);
    this.name = "RunStop";
  }
}

const stepId = (index: number) => `call:${index}`;

/** Whether a mined call is `tx`, by target, calldata and native value. */
const sameCall = (mined: { to: Address; input: Hex; value: bigint }, tx: FlowTx) =>
  isAddressEqual(mined.to, tx.to) && mined.input === (tx.data ?? "0x") && mined.value === (tx.value ?? 0n);

const isApprove = (tx: FlowTx) => (tx.data && tx.data.length >= 10 ? slice(tx.data, 0, 4) : "0x") === APPROVE_SELECTOR;

/** The token and amount an approve call names. */
function approved(tx: FlowTx) {
  const [, amount] = decodeFunctionData({ abi: erc20Abi, data: tx.data! }).args as readonly [Address, bigint];
  return { token: tx.to, amount };
}

/**
 * The balances call `index` relies on: an approve's own token, or for a redeem the tokens of the approves the planner
 * put right before it, each with the amount it names.
 */
function reliesOn(calls: FlowTx[], index: number) {
  if (isApprove(calls[index]!)) return [approved(calls[index]!)];
  const out = [];
  for (let at = index - 1; at >= 0 && isApprove(calls[at]!); at--) out.push(approved(calls[at]!));
  return out;
}

/** The session's markets and tokens as the reviewed input names them, which fetchWalletRedeemInput read on-chain. */
function scopeOf(input: WalletRedeemInput): RedeemScope {
  const children: RedeemScope["children"] = {};
  for (const [option, holdings] of Object.entries(input.childTokens)) {
    const child = input.resolution.children[Number(option)];
    if (child?.deployed) children[Number(option)] = { market: child.market, tokens: holdings!.map((h) => h.token) };
  }
  return {
    collateral: input.collateral,
    parentMarket: input.parentMarket,
    parentTokens: input.parentTokens.map((h) => h.token),
    children,
  };
}

const errorCode = (error: unknown) =>
  typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;

/**
 * Wallet answers to a send request that leave no prompt open and nothing signed, as the liquidity driver lists them
 * (liquidity oracle L8).
 */
const NO_PROMPT_CODES: ReadonlySet<unknown> = new Set([4100, 4200, -32601, -32602, 3, 5700, 5710, 5740, 5750, 5760]);

/** WalletConnect's USER_REJECTED, the code its relay answers a declined request with. */
const WALLETCONNECT_USER_REJECTED = 5000;

function inChain(error: unknown, test: (link: unknown) => boolean): boolean {
  for (let link = error, depth = 0; link && depth < 8; depth += 1) {
    if (test(link)) return true;
    link = typeof link === "object" ? (link as { cause?: unknown }).cause : undefined;
  }
  return false;
}

const walletConnectRejection = (error: unknown) =>
  inChain(error, (link) => errorCode(link) === WALLETCONNECT_USER_REJECTED);
const answeredWithoutPrompt = (error: unknown) => inChain(error, (link) => NO_PROMPT_CODES.has(errorCode(link)));

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/** A run holding a send or a batch id whose step has not settled stays stored past its expiry (R7). */
export function unsettledRedeemRun(run: Pick<PersistedFlowRun<unknown, unknown>, "snapshot" | "steps">): boolean {
  const snapshot = run.snapshot as Partial<RedeemSnapshot> | undefined;
  const open = new Set(
    run.steps
      .filter((step) => step.outcome.status !== "confirmed" && step.outcome.status !== "skipped")
      .map((step) => step.stepId),
  );
  return (
    Object.keys(snapshot?.sends ?? {}).some((id) => open.has(id)) ||
    (snapshot?.callsId !== undefined && open.has(BATCH))
  );
}

/**
 * Drives the connected wallet's redeem under adapter `redeem-flow`: one atomic `wallet_sendCalls` when the wallet
 * reports atomic batching, one prompt per call otherwise, each send stored before the wallet opens.
 */
export function createRedeemRun(args: {
  gateway: BalanceTxGateway;
  wallet: RedeemWallet;
  reader: RedeemReader;
  store: FlowRunStore;
  flowId: string;
  account: () => Address | undefined;
  chainId: () => number;
  /** What the Redeem section showed, read when start() is pressed. */
  request: () => WalletRedeemInput;
  now?: () => number;
  /** How often a sent batch's status is asked, in ms. */
  pollMs?: number;
}): RedeemRun {
  const pollMs = args.pollMs ?? 2_000;
  const listeners = new Set<() => void>();

  let failure: RedeemProgress["failure"];
  let retryFailed: (() => void) | undefined;
  let preparing = false;
  let recovering = false;
  let reviewing = false;
  let disposed = false;
  /** The stop a build or skip check raised, read when the orchestrator announces the pause or failure. */
  let stopped: RunStop | undefined;
  /** The batch the atomic step's build checked, sent by the gateway right after. */
  let batch: { id: string; account: Address; calls: FlowTx[] } | undefined;
  /** The wallet took the batch, which has not landed yet. */
  let batchSent = false;
  /** The send error the wallet answered without opening a prompt, read when the orchestrator classifies it. */
  let refused: unknown;

  /** The request's calls, checked against the allow-list (R8), the account and the chain. */
  function checkedCalls(request: WalletRedeemInput) {
    const account = args.account();
    if (!account || !isAddressEqual(account, request.owner)) throw new RunStop("wrong-wallet", true);
    if (args.chainId() !== request.chainId) throw new RunStop("wrong-chain", true);
    const { calls } = planWalletRedeem(request);
    if (calls.length === 0) throw new RunStop("unknown", false);
    const departures = redeemCallsDepartures({ calls, chainId: request.chainId, scope: scopeOf(request) });
    if (departures.length > 0) throw new RunStop("unlisted", false);
    return { calls, account };
  }

  /** Throws unless each balance `held` names still holds the amount shown at review (R6). */
  async function assertAsReviewed(held: { token: Address; amount: bigint }[], account: Address) {
    const balances = await Promise.all(held.map(({ token }) => args.reader.balanceOf(token, account)));
    if (balances.some((balance, index) => balance !== held[index]!.amount)) throw new RunStop("changed", false);
  }

  const run = () => orchestrator.getRun();

  /** Stores `tx` and the account's nonce with the run before the wallet is asked, so a prompt answered after the tab closed is found. */
  async function recordSend(id: string, account: Address, tx: FlowTx) {
    // read before the nonce, so the send mines after this block
    const fromBlock = await args.reader.blockNumber();
    if (await args.reader.hasPending(account)) throw new RunStop("pending", true);
    const nonce = await args.reader.nextNonce(account);
    const send: SendRecord = { tx, nonce, fromBlock };
    durably(id, () =>
      orchestrator.updateSnapshot((prev) => ({ ...prev, sends: { ...prev.sends, [id]: send } }), {
        source: "adapter",
        durable: true,
      }),
    );
  }

  /** Runs a durable write for `id`; when storage refuses it, the in-memory record is let go of as well. */
  function durably(id: string, write: () => void) {
    try {
      write();
    } catch (error) {
      if (error instanceof StorageWriteError) forget(id);
      throw error;
    }
  }

  function forget(id: string) {
    if (!run()) return;
    orchestrator.updateSnapshot(
      (prev) => {
        const { [id]: _forgotten, ...sends } = prev.sends;
        const { callsId: _id, ...rest } = prev;
        return id === BATCH ? { ...rest, sends } : { ...prev, sends };
      },
      { source: "adapter" },
    );
  }

  /** Whether a send stored for `id` landed: only the owner's successful transaction at its nonce making its call. */
  async function sentAlready(id: string, snapshot: Readonly<RedeemSnapshot>, ctx: RedeemCtx) {
    const send = snapshot.sends[id] as Partial<SendRecord> | undefined;
    if (!send) return false;
    if (await args.reader.hasPending(ctx.owner)) throw new RunStop("pending", true);
    // a record without its transaction cannot be matched to a mined one
    if (!send.tx || send.nonce === undefined || send.fromBlock === undefined) throw new RunStop("held", true);
    const found = await args.reader.sentWithNonce({ owner: ctx.owner, nonce: send.nonce, fromBlock: send.fromBlock });
    if (found.status === "pending") throw new RunStop("pending", true);
    if (found.status !== "mined" || !sameCall(found, send.tx)) throw new RunStop("held", true);
    const receipt = await args.gateway.getReceipt(found.hash);
    if (!receipt) throw new RunStop("pending", true);
    if (receipt.status !== "success") throw new RunStop("reverted", false);
    return true;
  }

  function sequentialStep(index: number): TxStep<RedeemSnapshot, RedeemCtx> {
    const id = stepId(index);
    return {
      id,
      label: id,
      canSkip: (ctx, snapshot) => sentAlready(id, snapshot, ctx),
      build: async (_ctx, snapshot) => {
        const { calls, account } = checkedCalls(snapshot.request);
        const tx = calls[index];
        if (!tx) throw new RunStop("unknown", false);
        await assertAsReviewed(reliesOn(calls, index), account);
        await recordSend(id, account, tx);
        return tx;
      },
    };
  }

  async function callsStatus(id: string): Promise<CallsStatus> {
    try {
      return (await args.wallet.request({ method: "wallet_getCallsStatus", params: [id] })) as CallsStatus;
    } catch (error) {
      if (errorCode(error) === UNKNOWN_BUNDLE) throw new RunStop("batch-unknown", false);
      throw error;
    }
  }

  /** EIP-5792 v2: 1xx pending, 2xx confirmed, anything else did not land. */
  async function batchLanded(snapshot: Readonly<RedeemSnapshot>) {
    if (snapshot.callsId === undefined) return false;
    const { status } = await callsStatus(snapshot.callsId);
    if (status < 200) throw new RunStop("pending", true);
    if (status < 300) return true;
    throw new RunStop("batch-failed", false);
  }

  const batchStep: TxStep<RedeemSnapshot, RedeemCtx> = {
    id: BATCH,
    label: BATCH,
    canSkip: (_ctx, snapshot) => batchLanded(snapshot),
    build: async (_ctx, snapshot) => {
      const { calls, account } = checkedCalls(snapshot.request);
      await assertAsReviewed(calls.filter(isApprove).map(approved), account);
      const id = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      durably(BATCH, () => orchestrator.updateSnapshot({ callsId: id }, { source: "adapter", durable: true }));
      batch = { id, account, calls };
      return { to: account, data: "0x" };
    },
  };

  async function sendBatch(sent: NonNullable<typeof batch>, signal?: AbortSignal): Promise<Hash> {
    await args.wallet.request({
      method: "wallet_sendCalls",
      params: [
        {
          version: "2.0.0",
          id: sent.id,
          chainId: numberToHex(args.chainId()),
          from: sent.account,
          atomicRequired: true,
          calls: sent.calls.map((tx) => ({
            to: tx.to,
            ...(tx.data === undefined ? {} : { data: tx.data }),
            ...(tx.value === undefined ? {} : { value: numberToHex(tx.value) }),
          })),
        },
      ],
    });
    batchSent = true;
    notify();
    for (;;) {
      const { status, receipts } = await callsStatus(sent.id);
      const hash = receipts?.at(-1)?.transactionHash;
      if (status >= 200 && status < 300 && hash) return hash;
      if (status >= 300) throw new RunStop("batch-failed", false);
      await sleep(pollMs, signal);
      if (signal?.aborted) throw new DOMException("The run was disposed.", "AbortError");
    }
  }

  const gateway: TxGateway = {
    ...args.gateway,
    async sendTransaction(tx, options) {
      const sent = batch;
      batch = undefined;
      try {
        return await (sent ? sendBatch(sent, options?.signal) : args.gateway.sendTransaction(tx, options));
      } catch (error) {
        // only the send request's own answer; a batch the wallet took is polled after, under its stored id
        const asking = sent ? (batchSent ? undefined : BATCH) : currentEntry(run()?.steps ?? [])?.stepId;
        // the failure persists the run right after, without the send
        if (asking && (isUserRejection(error) || walletConnectRejection(error))) forget(asking);
        else if (asking && answeredWithoutPrompt(error)) {
          forget(asking);
          refused = error;
        }
        throw error;
      } finally {
        batchSent = false;
      }
    },
  };

  const orchestrator = createTxOrchestrator<RedeemSnapshot, RedeemCtx>({
    adapterId: "redeem-flow",
    gateway,
    store: args.store,
    now: args.now,
    classifyError: (error) => {
      if (error instanceof StorageWriteError) error = new RunStop("storage", true);
      if (error !== undefined && error === refused) error = new RunStop("wallet", true);
      refused = undefined;
      // the shared classifier knows no WalletConnect codes, so a decline whose wording it misses would not retry
      if (walletConnectRejection(error)) return "rejected";
      if (error instanceof RunStop) {
        stopped = error;
        return error.retryable ? "rpc" : "unknown";
      }
      return classifyTxError(error);
    },
  });

  let cached: RedeemProgress = { stage: "idle" };

  function stage(): RedeemProgress["stage"] {
    if (failure) return "halted";
    if (recovering) return "confirming";
    if (reviewing) return "review";
    const current = run();
    if (!current) return preparing ? "signing" : "idle";
    switch (current.status) {
      case "completed":
        return "complete";
      case "running":
        return batchSent || currentEntry(current.steps)?.outcome.status === "submitted" ? "confirming" : "signing";
      default:
        return "halted";
    }
  }

  function notify() {
    cached = { stage: stage(), ...(failure ? { failure } : {}) };
    for (const listener of listeners) listener();
  }

  function report(reason: RedeemFailureReason | undefined, retry?: () => void) {
    failure = reason === undefined ? undefined : { reason, retryable: Boolean(retry) };
    retryFailed = reason === undefined ? undefined : retry;
    notify();
  }

  function stop(error: unknown, retry: () => void) {
    if (!(error instanceof RunStop)) {
      report(classifyTxError(error), retry);
      return;
    }
    report(error.reason, error.retryable ? retry : undefined);
  }

  function detached(work: () => Promise<void>): () => void {
    const action = () => void work().catch((error: unknown) => stop(error, action));
    return action;
  }

  const resumeRun = detached(() => orchestrator.resume());

  function halt(paused: boolean) {
    const raised = stopped;
    stopped = undefined;
    const current = run();
    const error = current?.status === "paused" || current?.status === "failed" ? current.error : undefined;
    const cause = error?.cause;
    // a reverted send, or a batch the wallet reports did not land, can no longer land
    const settled = raised ? raised.reason === "reverted" || raised.reason === "batch-failed" : cause === "reverted";
    if (!paused && settled && error) forget(error.stepId);
    if (raised) stop(raised, resumeRun);
    else report(cause ?? "unknown", paused ? resumeRun : undefined);
  }

  orchestrator.subscribe(notify);
  // a cancelled send can no longer mine; a refused prompt is let go of in the gateway, where its code is known
  orchestrator.on("step:failed", ({ stepId: id, error }) => {
    if (error.cause === "cancelled") forget(id);
  });
  orchestrator.on("flow:paused", () => halt(true));
  orchestrator.on("flow:failed", () => halt(false));

  const stepsFor = (snapshot: RedeemSnapshot) =>
    snapshot.atomic ? [batchStep] : planWalletRedeem(snapshot.request).calls.map((_, index) => sequentialStep(index));

  /** Whether the wallet reports atomic batching for `chainId` (EIP-5792 v2); anything else signs one by one. */
  async function atomicReady(account: Address, chainId: number) {
    const chain = numberToHex(chainId);
    try {
      const capabilities = (await args.wallet.request({
        method: "wallet_getCapabilities",
        params: [account, [chain]],
      })) as Record<string, { atomic?: { status?: string } }>;
      const status = Object.entries(capabilities).find(([key]) => key.toLowerCase() === chain)?.[1]?.atomic?.status;
      return status === "supported" || status === "ready";
    } catch {
      return false;
    }
  }

  const startRun = detached(async () => {
    const request = args.request();
    preparing = true;
    notify();
    let account: Address;
    let atomic: boolean;
    try {
      ({ account } = checkedCalls(request));
      atomic = await atomicReady(account, request.chainId);
    } finally {
      preparing = false;
    }
    if (disposed) return;
    const snapshot: RedeemSnapshot = { request, atomic, sends: {} };
    await orchestrator.start({
      flowId: args.flowId,
      snapshot,
      ctx: { owner: account, chainId: request.chainId },
      steps: stepsFor(snapshot),
    });
  });

  /** A stored run is restored only for the account that started it, and held for review: nothing is signed until resume. */
  function recoverRun() {
    const stored = args.store.load<RedeemSnapshot, RedeemCtx>(args.flowId);
    if (!stored) return;
    const account = args.account();
    if (!account || !isAddressEqual(stored.ctx.owner, account)) {
      report("wrong-wallet", recoverRun);
      return;
    }
    if (stored.ctx.chainId !== args.chainId()) {
      report("wrong-chain", recoverRun);
      return;
    }
    report(undefined);
    recovering = true;
    notify();
    detached(async () => {
      try {
        orchestrator.restore({ flowId: args.flowId, steps: stepsFor(stored.snapshot) });
        const found = await orchestrator.reconcileInFlight();
        // a revert or a cancel is reported by the orchestrator's own event
        if (found.outcome !== "reverted" && found.outcome !== "cancelled" && !disposed) reviewing = true;
      } finally {
        recovering = false;
        notify();
      }
    })();
  }

  const busy = () => disposed || preparing || recovering;

  /** A send of the run may still land: a submitted step, or a send or batch id stored for a step not settled. */
  const holdsSend = (stored: Pick<PersistedFlowRun<RedeemSnapshot, RedeemCtx>, "snapshot" | "steps">) =>
    unsettledRedeemRun(stored) || stored.steps.some((step) => step.outcome.status === "submitted");

  return {
    start() {
      if (busy()) return;
      // a finished or stopped run that holds no send is let go of; the next press redeems what the new list shows
      const current = run();
      if (current && current.status !== "running" && !holdsSend(current)) orchestrator.trash();
      if (orchestrator.getStatus() !== "idle") return;
      const stored = args.store.load<RedeemSnapshot, RedeemCtx>(args.flowId);
      const account = args.account();
      if (stored && !holdsSend(stored) && account && isAddressEqual(stored.ctx.owner, account)) {
        orchestrator.trash(args.flowId);
      } else if (stored) {
        // its sends may be on chain already
        recoverRun();
        return;
      }
      report(undefined);
      startRun();
    },

    recover() {
      if (busy() || orchestrator.getStatus() !== "idle") return;
      recoverRun();
    },

    resume() {
      if (!reviewing || busy()) return;
      reviewing = false;
      report(undefined);
      resumeRun();
    },

    retry() {
      const again = retryFailed;
      if (!again || busy()) return;
      report(undefined);
      again();
    },

    dispose() {
      disposed = true;
      orchestrator.dispose();
    },

    getProgress: () => cached,

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

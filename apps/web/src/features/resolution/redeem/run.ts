import {
  classifyTxError,
  createTxOrchestrator,
  currentEntry,
  encodeState,
  isUserRejection,
  StorageWriteError,
  type BalanceTxGateway,
  type FlowRunStore,
  type FlowTx,
  type PersistedFlowRun,
  type PersistedFlowRunInput,
  type StepSummary,
  type TxGateway,
  type TxStep,
} from "@foresight/tx-orchestrator";
import { bytesToHex, decodeFunctionData, isAddressEqual, numberToHex, parseAbi, type Address, type Hash } from "viem";

import type { SentWithNonce } from "@/lib/web3/sentWithNonce";
import {
  answeredWithoutPrompt,
  errorCode,
  sameCall,
  sleep,
  UNKNOWN_BUNDLE,
  walletConnectRejection,
} from "@/lib/web3/walletAnswers";

import { conditionalRouterAbi } from "./abi";
import { RedeemLockError } from "./lock";
import { planWalletRedeem, type RedeemHolding, type WalletRedeemInput } from "./plan";
import { redeemCallsDepartures, type RedeemScope } from "./tradeWalletBatchAllowed";
import { REDEEM_ALLOW_LIST } from "../oracle/allowlist";

export type { SentWithNonce };

/** Why a run halted: the orchestrator's own causes, then the redeem run's. */
export type RedeemFailureReason =
  | "rejected"
  | "cancelled"
  | "reverted"
  | "rpc"
  | "unknown"
  /** A call departs from the oracle's R2 to R4, so it was not sent (R8). */
  | "unlisted"
  /** A balance the run redeems no longer reads as reviewed (R6); nothing more is signed until a new review. */
  | "changed"
  /** The run belongs to another account than the connected one, or none is connected. */
  | "wrong-wallet"
  | "wrong-chain"
  /** The account has a send not yet mined, or a sent batch is not yet confirmed. */
  | "pending"
  /** A call was asked of the wallet and the chain shows no send of it; it is never signed again, only discarded. */
  | "held"
  /** The wallet answered with an error that leaves no prompt open, so the call can be asked again. */
  | "wallet"
  | "storage"
  /** Another tab changed the stored run, so this one stopped before asking the wallet anything. */
  | "elsewhere"
  /** The wallet cannot report a sent batch, so it is never sent again, only discarded. */
  | "batch-unknown"
  /** The wallet reports the batch did not land. */
  | "batch-failed";

export interface RedeemProgress {
  stage: "idle" | "signing" | "confirming" | "review" | "halted" | "complete";
  failure?: { reason: RedeemFailureReason; retryable: boolean };
  /** The stopped run holds a send or batch id that may still land, which only a confirmed discard lets go of. */
  holdsSend?: true;
  /** The run is one EIP-5792 batch. */
  atomic?: true;
}

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
  /** Forgets a stopped run unless it holds a send that may still land. */
  reset(): void;
  /**
   * Lets go of a stopped run's sends, signing nothing; for the UI to call once the user confirmed. Settled steps are
   * kept for resume. Refused, as `pending`, while the chain shows one of its sends broadcast or landed.
   */
  discard(): Promise<void>;
  dispose(): void;
  getProgress(): RedeemProgress;
  subscribe(listener: () => void): () => void;
}

const BATCH = "batch";
const callStep = (index: number) => `call:${index}`;

/** A send asked of the wallet: the transaction built for it, the account's next nonce, and the head block before. */
interface SendRecord {
  tx: FlowTx;
  nonce: number;
  fromBlock: bigint;
}

interface RedeemSnapshot {
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

type StoredRun = Pick<PersistedFlowRun<RedeemSnapshot, RedeemCtx>, "snapshot" | "ctx" | "steps">;

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

/** A save or clear refused because the stored run is not the one this run last read or wrote. */
class StaleRunError extends Error {
  constructor() {
    super("Another tab changed this redeem run.");
    this.name = "StaleRunError";
  }
}

const settledIds = (steps: readonly StepSummary[]) =>
  new Set(
    steps
      .filter(({ outcome }) => outcome.status === "confirmed" || outcome.status === "skipped")
      .map(({ stepId }) => stepId),
  );

/** Whether a run holds a send or batch id whose step has not settled, or a broadcast hash: it may still land. */
export function mayStillLand(run: { snapshot: unknown; steps: readonly StepSummary[] }): boolean {
  const snapshot = run.snapshot as Partial<RedeemSnapshot> | undefined;
  const settled = settledIds(run.steps);
  const open = run.steps.filter(({ stepId }) => !settled.has(stepId));
  return (
    open.some(({ outcome }) => outcome.status === "submitted") ||
    Object.keys(snapshot?.sends ?? {}).some((stepId) => open.some((step) => step.stepId === stepId)) ||
    (snapshot?.callsId !== undefined && open.some(({ stepId }) => stepId === BATCH))
  );
}

/** The session's markets and tokens as the request names them, which `fetchWalletRedeemInput` read on-chain. */
function scopeOf(input: WalletRedeemInput): RedeemScope {
  const children: RedeemScope["children"] = {};
  for (const [key, holdings] of Object.entries(input.childTokens)) {
    const child = input.resolution.children[Number(key)];
    if (child?.deployed && holdings)
      children[Number(key)] = { market: child.market, tokens: holdings.map((h) => h.token) };
  }
  return {
    collateral: input.collateral,
    parentMarket: input.parentMarket,
    parentTokens: input.parentTokens.map((holding) => holding.token),
    children,
  };
}

const REDEEM_POSITIONS_ABI = parseAbi([
  "function redeemPositions(address collateralToken, address market, uint256[] outcomeIndexes, uint256[] amounts)",
]);

/** The outcome tokens `call` moves: an approve's token, or every token a redeem pulls. */
function tokensOf(call: FlowTx, scope: RedeemScope, chainId: number): Address[] {
  const list = REDEEM_ALLOW_LIST[chainId]!;
  const data = call.data ?? "0x";
  if (isAddressEqual(call.to, list.gnosisRouter)) {
    const [, , indexes] = decodeFunctionData({ abi: REDEEM_POSITIONS_ABI, data }).args;
    return indexes.map((index) => scope.parentTokens[Number(index)]!);
  }
  if (isAddressEqual(call.to, list.conditionalRouter)) {
    const [, market, indexes] = decodeFunctionData({ abi: conditionalRouterAbi, data }).args;
    const child = Object.values(scope.children).find((each) => isAddressEqual(each!.market, market))!;
    return indexes.map((index) => child.tokens[Number(index)]!);
  }
  return [call.to];
}

function reviewedBalance(input: WalletRedeemInput, token: Address): bigint | undefined {
  const holdings: RedeemHolding[] = [
    ...input.parentTokens,
    ...Object.values(input.childTokens).flatMap((each) => each ?? []),
  ];
  return holdings.find((holding) => isAddressEqual(holding.token, token))?.balance;
}

/** Drives one connected wallet redeem of a session, under adapter `redeem-flow`, as the liquidity driver does. */
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
  /** Browser callers serialize every storage mutation and send across tabs. */
  withLock?: (work: () => Promise<void>, signal: AbortSignal) => Promise<void>;
}): RedeemRun {
  const pollMs = args.pollMs ?? 2_000;
  const listeners = new Set<() => void>();
  const lifetime = new AbortController();

  let failure: RedeemProgress["failure"];
  let retryFailed: (() => void | Promise<void>) | undefined;
  let acquiring = false;
  let preparing = false;
  let recovering = false;
  let reviewing = false;
  let discarding = false;
  let disposed = false;
  /** The stop a build or skip check raised, read when the orchestrator announces the pause or failure. */
  let stopped: RunStop | undefined;
  /** The batch the atomic step's build checked, sent by the gateway right after. */
  let batch: { id: string; account: Address; calls: FlowTx[] } | undefined;
  /** The wallet took the batch, which has not landed yet. */
  let batchSent = false;
  /** The send error the wallet answered without opening a prompt, read when the orchestrator classifies it. */
  let refused: unknown;

  // A run restored before another tab held the lock must reread its state before carrying on.
  const base = args.store;
  const mark = (flowId: string) => encodeState(base.load(flowId));
  /** The stored run as this run last read or wrote it; unset until it first reads. */
  let known: string | undefined;
  const inSync = () => known === mark(args.flowId);
  const guard = (flowId: string) => {
    if (known !== mark(flowId)) throw new StaleRunError();
  };
  const store: FlowRunStore = {
    save<S, C>(run: PersistedFlowRunInput<S, C>) {
      guard(run.flowId);
      base.save(run);
      known = mark(run.flowId);
    },
    load<S, C>(flowId: string) {
      const loaded = base.load<S, C>(flowId);
      known = encodeState(loaded);
      return loaded;
    },
    list: () => base.list(),
    clear(flowId) {
      guard(flowId);
      base.clear(flowId);
      known = mark(flowId);
    },
    clearAll: () => base.clearAll(),
  };

  const run = () => orchestrator.getRun();

  /** Throws unless the connected account and chain are the request's. */
  function checkedCalls(request: WalletRedeemInput) {
    const account = args.account();
    if (!account || !isAddressEqual(account, request.owner)) throw new RunStop("wrong-wallet", true);
    if (args.chainId() !== request.chainId) throw new RunStop("wrong-chain", true);
    const { calls } = planWalletRedeem(request);
    if (calls.length === 0) throw new RunStop("unknown", false);
    const scope = scopeOf(request);
    if (redeemCallsDepartures({ calls, chainId: request.chainId, scope }).length > 0) {
      throw new RunStop("unlisted", false);
    }
    return { calls, account, scope };
  }

  /** R6: every token `calls` move still holds what the Redeem section showed. */
  async function assertAsReviewed(calls: FlowTx[], scope: RedeemScope, request: WalletRedeemInput, account: Address) {
    const tokens = calls.flatMap((call) => tokensOf(call, scope, request.chainId));
    const reads = tokens.map(
      async (token) => (await args.reader.balanceOf(token, account)) === reviewedBalance(request, token),
    );
    if (!(await Promise.all(reads)).every(Boolean)) throw new RunStop("changed", false);
  }

  /** A durable snapshot write; on failure the snapshot in memory is put back, so no send is held that storage lacks. */
  function durably(patch: (prev: Readonly<RedeemSnapshot>) => RedeemSnapshot) {
    const before = run()!.snapshot;
    try {
      orchestrator.updateSnapshot(patch, { source: "adapter", durable: true });
    } catch (error) {
      if (run()) orchestrator.updateSnapshot(() => before, { source: "adapter" });
      throw error;
    }
  }

  /** Stores `tx` and the account's nonce with the run before the wallet is asked, so a prompt answered later is found. */
  async function recordSend(stepId: string, account: Address, tx: FlowTx) {
    // read before the nonce, so the send mines after this block
    const fromBlock = await args.reader.blockNumber();
    if (await args.reader.hasPending(account)) throw new RunStop("pending", true);
    const nonce = await args.reader.nextNonce(account);
    durably((prev) => ({ ...prev, sends: { ...prev.sends, [stepId]: { tx, nonce, fromBlock } } }));
  }

  function forget(stepId: string) {
    if (!run()) return;
    orchestrator.updateSnapshot(
      (prev) => {
        const { [stepId]: _forgotten, ...sends } = prev.sends;
        const { callsId: _id, ...rest } = prev;
        return stepId === BATCH ? { ...rest, sends } : { ...prev, sends };
      },
      { source: "adapter" },
    );
  }

  /** Drops the sends and batch id of every step not settled, so each is built and asked for afresh. */
  function forgetUnsettled() {
    const settled = settledIds(run()?.steps ?? []);
    durably((prev) => {
      const sends = Object.fromEntries(Object.entries(prev.sends).filter(([stepId]) => settled.has(stepId)));
      const { callsId: _id, ...rest } = prev;
      return { ...rest, sends };
    });
  }

  /** Whether a send stored for `stepId` landed: only the owner's successful transaction at its nonce making its call. */
  async function sentAlready(stepId: string, snapshot: Readonly<RedeemSnapshot>, ctx: RedeemCtx) {
    const send = snapshot.sends[stepId] as Partial<SendRecord> | undefined;
    if (!send) return false;
    if (await args.reader.hasPending(ctx.owner)) throw new RunStop("pending", true);
    // a record without its transaction cannot be matched to a mined one
    if (!send.tx || send.nonce === undefined || send.fromBlock === undefined) throw new RunStop("held", true);
    const found = await args.reader.sentWithNonce({ owner: ctx.owner, nonce: send.nonce, fromBlock: send.fromBlock });
    if (found.status === "pending") throw new RunStop("pending", true);
    if (found.status !== "mined" || !sameCall(found, send.tx)) throw new RunStop("held", true);
    const receipt = await args.gateway.getReceipt(found.hash);
    if (!receipt) throw new RunStop("pending", true);
    if (receipt.status !== "success") {
      // mined and reverted, so it can never land
      forget(stepId);
      throw new RunStop("reverted", false);
    }
    return true;
  }

  function sequentialStep(index: number): TxStep<RedeemSnapshot, RedeemCtx> {
    const id = callStep(index);
    return {
      id,
      label: id,
      canSkip: (ctx, snapshot) => sentAlready(id, snapshot, ctx),
      build: async (_ctx, snapshot) => {
        const { calls, account, scope } = checkedCalls(snapshot.request);
        const tx = calls[index];
        if (!tx) throw new RunStop("unknown", false);
        await assertAsReviewed([tx], scope, snapshot.request, account);
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
    forget(BATCH);
    throw new RunStop("batch-failed", false);
  }

  const batchStep: TxStep<RedeemSnapshot, RedeemCtx> = {
    id: BATCH,
    label: BATCH,
    canSkip: (_ctx, snapshot) => batchLanded(snapshot),
    build: async (_ctx, snapshot) => {
      const { calls, account, scope } = checkedCalls(snapshot.request);
      await assertAsReviewed(calls, scope, snapshot.request, account);
      const id = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      durably((prev) => ({ ...prev, callsId: id }));
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
      if (status >= 300) {
        forget(BATCH);
        throw new RunStop("batch-failed", false);
      }
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
    store,
    now: args.now,
    classifyError: (error) => {
      if (error instanceof StorageWriteError) error = new RunStop(inSync() ? "storage" : "elsewhere", true);
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
    if (acquiring || recovering || discarding) return "confirming";
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
    const current = run();
    const holds = current !== null && current.status !== "running" && mayStillLand(current);
    cached = {
      stage: stage(),
      ...(failure ? { failure } : {}),
      ...(holds ? { holdsSend: true as const } : {}),
      ...(current?.snapshot.atomic ? { atomic: true as const } : {}),
    };
    for (const listener of listeners) listener();
  }

  function report(reason: RedeemFailureReason | undefined, retry?: () => void | Promise<void>) {
    failure = reason === undefined ? undefined : { reason, retryable: Boolean(retry) };
    retryFailed = reason === undefined ? undefined : retry;
    notify();
  }

  function stop(error: unknown, retry: () => void | Promise<void>) {
    if (error instanceof RedeemLockError) error = new RunStop(error.reason, true);
    if (!(error instanceof RunStop)) {
      report(classifyTxError(error), retry);
      return;
    }
    report(error.reason, error.retryable ? retry : undefined);
  }

  function detached(work: () => Promise<void>): () => Promise<void> {
    const action = () => work().catch((error: unknown) => stop(error, action));
    return action;
  }

  const driveOn = detached(() => orchestrator.resume());
  /** Carries the run on, or, when another tab changed it since, loads it again for review. */
  const resumeRun = () => (run() && inSync() ? driveOn() : recoverRun());

  function halt(paused: boolean) {
    const raised = stopped;
    stopped = undefined;
    const current = run();
    const cause = current?.status === "paused" || current?.status === "failed" ? current.error?.cause : undefined;
    if (raised) stop(raised, resumeRun);
    else report(cause ?? "unknown", paused ? resumeRun : undefined);
  }

  orchestrator.subscribe(notify);
  // a cancelled send can no longer land, so its step may be asked for again
  orchestrator.on("step:failed", ({ stepId, error }) => {
    if (error.cause === "cancelled") forget(stepId);
  });
  // a reverted send cannot land again either; the loop and a reload both announce it with flow:failed
  orchestrator.on("flow:failed", ({ error }) => {
    if (error.cause === "reverted") forget(error.stepId);
    halt(false);
  });
  orchestrator.on("flow:paused", () => halt(true));

  function stepsFor(snapshot: RedeemSnapshot) {
    return snapshot.atomic
      ? [batchStep]
      : planWalletRedeem(snapshot.request).calls.map((_, index) => sequentialStep(index));
  }

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
    let checked: ReturnType<typeof checkedCalls>;
    let atomic: boolean;
    try {
      checked = checkedCalls(request);
      atomic = await atomicReady(checked.account, request.chainId);
    } finally {
      preparing = false;
    }
    if (disposed) return;
    // another tab may have stored a run since the press
    if (store.load(args.flowId)) {
      await recoverRun();
      return;
    }
    const snapshot: RedeemSnapshot = { request, atomic, sends: {} };
    await orchestrator.start({
      flowId: args.flowId,
      snapshot,
      ctx: { owner: checked.account, chainId: request.chainId },
      steps: stepsFor(snapshot),
    });
  });

  const ownedHere = (stored: StoredRun) => {
    const account = args.account();
    return account !== undefined && isAddressEqual(stored.ctx.owner, account);
  };

  /** Loads the stored run for review, signing nothing; only the account and chain that started it may restore it. */
  async function recoverRun() {
    const stored = store.load<RedeemSnapshot, RedeemCtx>(args.flowId);
    if (!stored) {
      if (run()) orchestrator.trash();
      reviewing = false;
      report(undefined);
      return;
    }
    if (!ownedHere(stored)) {
      report("wrong-wallet", recoverRun);
      return;
    }
    if (stored.ctx.chainId !== args.chainId()) {
      report("wrong-chain", recoverRun);
      return;
    }
    reviewing = false;
    report(undefined);
    recovering = true;
    notify();
    await detached(async () => {
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

  const busy = () => disposed || acquiring || preparing || recovering || discarding;

  /** Whether a send of `stored` is broadcast or has landed; resume, not a discard, must settle it. */
  async function mayHaveLanded({ snapshot, ctx, steps }: StoredRun) {
    if (await args.reader.hasPending(ctx.owner)) return true;
    const settled = settledIds(steps);
    if (snapshot.callsId !== undefined && !settled.has(BATCH)) {
      try {
        if ((await callsStatus(snapshot.callsId)).status < 300) return true;
      } catch (error) {
        // a batch the wallet cannot report, with no send of the account broadcast, is let go of once confirmed
        if (!(error instanceof RunStop && error.reason === "batch-unknown")) throw error;
      }
    }
    for (const step of steps) {
      if (step.outcome.status !== "submitted") continue;
      const receipt = await args.gateway.getReceipt(step.outcome.hash);
      if (!receipt || receipt.status === "success") return true;
    }
    for (const step of steps) {
      const send = snapshot.sends[step.stepId] as Partial<SendRecord> | undefined;
      if (settled.has(step.stepId) || !send?.tx || send.nonce === undefined || send.fromBlock === undefined) continue;
      const found = await args.reader.sentWithNonce({ owner: ctx.owner, nonce: send.nonce, fromBlock: send.fromBlock });
      if (found.status === "pending") return true;
      if (found.status !== "mined" || !sameCall(found, send.tx)) continue;
      const receipt = await args.gateway.getReceipt(found.hash);
      if (!receipt || receipt.status === "success") return true;
    }
    return false;
  }

  /** Lets go of a run that holds nothing that may land: the orchestrator's copy and the stored one. */
  function drop(stored: StoredRun | null) {
    if (run()) orchestrator.trash();
    else if (stored) orchestrator.trash(args.flowId);
    reviewing = false;
    report(undefined);
  }

  const actions = {
    start() {
      if (busy() || orchestrator.getStatus() === "running") return;
      const stored = store.load<RedeemSnapshot, RedeemCtx>(args.flowId);
      // a stored run that may still land is settled by resume, never replaced
      if (stored && (mayStillLand(stored) || !ownedHere(stored))) {
        return recoverRun();
      }
      drop(stored);
      return startRun();
    },

    recover() {
      if (busy() || orchestrator.getStatus() === "running") return;
      return recoverRun();
    },

    resume() {
      if (!reviewing || busy()) return;
      reviewing = false;
      report(undefined);
      return resumeRun();
    },

    retry() {
      const again = retryFailed;
      if (!again || busy()) return;
      report(undefined);
      return again();
    },

    reset() {
      if (busy() || orchestrator.getStatus() === "running") return;
      const stored = store.load<RedeemSnapshot, RedeemCtx>(args.flowId);
      if (stored && (mayStillLand(stored) || !ownedHere(stored))) return;
      drop(stored);
    },

    async discard() {
      const status = orchestrator.getStatus();
      const canDiscard = failure || reviewing || status === "paused" || status === "failed";
      if (busy() || status === "running" || !canDiscard) return;
      const stored = store.load<RedeemSnapshot, RedeemCtx>(args.flowId);
      if (!stored) {
        drop(null);
        return;
      }
      if (!ownedHere(stored)) {
        report("wrong-wallet", recoverRun);
        return;
      }
      // the probe reads the connected chain
      if (stored.ctx.chainId !== args.chainId()) {
        report("wrong-chain", recoverRun);
        return;
      }
      // whatever the probe finds, the run leaves review: a refusal halts it, a let-go reviews it afresh
      reviewing = false;
      discarding = true;
      notify();
      let landing: boolean;
      try {
        landing = await mayHaveLanded(stored);
      } catch (error) {
        stop(error, recoverRun);
        return;
      } finally {
        discarding = false;
      }
      if (disposed) return;
      if (!inSync()) {
        return recoverRun();
      }
      if (landing) {
        report("pending", resumeRun);
        return;
      }
      if (settledIds(stored.steps).size === 0) {
        drop(stored);
        return;
      }
      try {
        orchestrator.restore({ flowId: args.flowId, steps: stepsFor(stored.snapshot) });
        // a submitted step whose receipt reverted is asked for again
        orchestrator.releaseInFlight();
        forgetUnsettled();
      } catch (error) {
        stop(error, recoverRun);
        return;
      }
      reviewing = true;
      report(undefined);
    },
  };

  function locked(action: () => void | Promise<void>): () => Promise<void> {
    const attempt = async () => {
      if (busy() || orchestrator.getStatus() === "running") return;
      const retry = action === actions.retry ? retryFailed : action;
      try {
        if (!args.withLock) {
          await action();
          return;
        }
        acquiring = true;
        notify();
        await args.withLock(async () => {
          acquiring = false;
          if (!disposed) await action();
        }, lifetime.signal);
      } catch (error) {
        if (!disposed) stop(error, retry ?? actions.recover);
      } finally {
        acquiring = false;
        if (!disposed) notify();
      }
    };
    return attempt;
  }

  return {
    start: locked(actions.start),
    recover: locked(actions.recover),
    resume: locked(actions.resume),
    retry: locked(actions.retry),
    reset: locked(actions.reset),
    discard: locked(actions.discard),

    dispose() {
      disposed = true;
      orchestrator.dispose();
      lifetime.abort();
    },

    getProgress: () => cached,

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

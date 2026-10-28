"use client";

import {
  classifyTxError,
  createTxOrchestrator,
  currentEntry,
  settledEntries,
  StorageWriteError,
  type BalanceTxGateway,
  type FlowRunStore,
  type FlowTx,
  type TxGateway,
  type TxStep,
} from "@foresight/tx-orchestrator";
import {
  bytesToHex,
  decodeEventLog,
  isAddressEqual,
  numberToHex,
  parseAbi,
  zeroAddress,
  type Address,
  type Hash,
  type TransactionReceipt,
} from "viem";

import { assertListed, UnlistedTxError } from "../flow/allowed";
import { planMerge, planRemove, planSeed } from "../flow/plan";
import { LIQUIDITY_ALLOW_LIST } from "../oracle/allowlist";
import { GAS_RESERVE_WEI } from "../oracle/tolerances";
import type {
  LiquidityFailureReason,
  LiquidityProgress,
  LiquidityReader,
  LiquidityRequest,
  LiquiditySession,
  LiquidityStep,
  PoolState,
  SeedInput,
} from "../types";

/** A prompt open when its tab went away may still be approved; for this long, in ms, its step is not signed again. */
export const SEND_HOLD_MS = 600_000;

export const BATCH = "batch";

/** EIP-5792's error for a batch id the wallet does not know. */
const UNKNOWN_BUNDLE = 5730;

const TRANSFER_ABI = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"]);

/** A send asked of the wallet: the account's next nonce when it was asked, and when. */
interface SendRecord {
  nonce: number;
  heldAt: number;
}

export interface LiquiditySnapshot {
  /** What was reviewed; every build re-plans from it. */
  request: LiquidityRequest;
  atomic: boolean;
  sends: Record<string, SendRecord>;
  /** The id of the batch asked of the wallet; while set, the batch is never asked for again. */
  callsId?: string;
  /** Token ids minted by a step, by step id, for the step that withdraws it. */
  minted: Record<string, bigint>;
}

interface LiquidityCtx {
  owner: Address;
  chainId: number;
}

/** EIP-1193: the connected wallet's provider. */
export interface LiquidityWallet {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}

interface CallsStatus {
  status: number;
  receipts?: { transactionHash: Hash }[];
}

/** Why the run stopped, which the orchestrator's own causes cannot carry. */
class RunStop extends Error {
  constructor(
    readonly reason: LiquidityFailureReason | "moved",
    readonly retryable: boolean,
  ) {
    super(reason);
    this.name = "RunStop";
  }
}

const sessionOf = (request: LiquidityRequest): LiquiditySession =>
  request.kind === "remove" ? request.session : request.input.session;

/** The request's steps, with deadlines from `chainTime` where given; ids do not depend on it. */
function planned(request: LiquidityRequest, chainTime?: bigint): LiquidityStep[] {
  switch (request.kind) {
    case "seed":
      return planSeed({ ...request.input, chainTime: chainTime ?? request.input.chainTime }).steps;
    case "remove":
      return [
        { id: "remove", tx: planRemove({ ...request.input, chainTime: chainTime ?? request.input.chainTime }).tx },
      ];
    case "merge":
      return planMerge(request.input).txs.map((tx, index) => ({ id: `merge:${index}`, tx }));
  }
}

const poolKey = (pool: PoolState) =>
  pool.status === "missing"
    ? "missing"
    : `${pool.status}:${pool.sqrtPriceX96}:${pool.tickSpacing}:${pool.status === "live" ? pool.liquidity : ""}`;

/** The NFT a position manager mint in `receipt` gave out. */
function mintedTokenId(receipt: TransactionReceipt, positionManager: Address): bigint | undefined {
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, positionManager)) continue;
    try {
      const { args } = decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: log.topics });
      if (isAddressEqual(args.from, zeroAddress)) return args.tokenId;
    } catch {
      // another of the position manager's events
    }
  }
  return undefined;
}

const errorCode = (error: unknown) =>
  typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/** Drives one liquidity run (seed, add, remove or merge) from the connected wallet, under adapter `liquidity-flow`. */
export function createLiquidityRun(args: {
  gateway: BalanceTxGateway;
  wallet: LiquidityWallet;
  reader: LiquidityReader;
  store: FlowRunStore;
  flowId: string;
  account: () => Address | undefined;
  chainId: () => number;
  /** What the popup reviewed, read when start() is pressed. */
  request: () => LiquidityRequest;
  /** The session's close, in chain seconds. */
  closesAt: bigint;
  now?: () => number;
  /** How often a sent batch's status is asked, in ms. */
  pollMs?: number;
}) {
  const now = args.now ?? Date.now;
  const pollMs = args.pollMs ?? 2_000;
  const listeners = new Set<() => void>();

  let failure: LiquidityProgress["failure"];
  let retryFailed: (() => void) | undefined;
  let moved = false;
  let preparing = false;
  let recovering = false;
  let reviewing = false;
  let disposed = false;
  /** The stop a build or skip check raised, read when the orchestrator announces the pause or failure. */
  let stopped: RunStop | undefined;
  /** Steps whose minted token id a later step withdraws. */
  let dustIds = new Set<string>();
  /** The batch the atomic step's build checked, sent by the gateway right after. */
  let batch: { id: string; account: Address; calls: FlowTx[] } | undefined;

  async function assertHolds(tokenId: bigint, account: Address) {
    if (!isAddressEqual(await args.reader.ownerOf(tokenId), account)) throw new RunStop("unlisted", false);
  }

  /** Throws when a pool the seed reviewed reads otherwise now. */
  async function assertPoolsAsReviewed(input: SeedInput, settled: ReadonlySet<string>) {
    const reads = input.branches.flatMap((reviewed, index) => {
      const tokens = input.session.branches[index]!;
      // the run's own seed mint moves both of its branch's pools
      if (settled.has(`branch:${index}:seed`)) return [];
      return (
        (["up", "down"] as const)
          // the run's own dust mint moves a pool it realigns; the swap's cap and the seed's minimums hold it after (L3)
          .filter((side) => !settled.has(`branch:${index}:${side}:dust`))
          .map(async (side) => {
            const child = side === "up" ? tokens.upToken : tokens.downToken;
            return poolKey(await args.reader.pool(child, tokens.outcome)) === poolKey(reviewed.pools[side]);
          })
      );
    });
    if (!(await Promise.all(reads)).every(Boolean)) throw new RunStop("moved", false);
  }

  /** The request's steps as the chain stands now, every static one checked against flow/allowed.ts (L4, L5, L7, L10, L13). */
  async function checkedSteps(request: LiquidityRequest, settled: ReadonlySet<string> = new Set()) {
    const account = args.account();
    if (!account) throw new RunStop("wrong-wallet", true);
    const session = sessionOf(request);
    if (args.chainId() !== session.chainId) throw new RunStop("wrong-chain", true);
    const chainTime = await args.reader.chainTime();
    if (request.kind === "seed") {
      if (chainTime >= args.closesAt) throw new RunStop("closed", false);
      await assertPoolsAsReviewed(request.input, settled);
    }
    if (request.kind === "remove") {
      const { position, sqrtPriceX96 } = request.input;
      const pool = await args.reader.pool(position.token0, position.token1);
      if (pool.status !== "live" || pool.sqrtPriceX96 !== sqrtPriceX96) throw new RunStop("moved", false);
      await assertHolds(position.tokenId, account);
    }
    const steps = planned(request, chainTime);
    for (const step of steps) {
      if (step.tx) assertListed({ tx: step.tx, session, owner: request.input.owner, from: account });
    }
    const value = steps.reduce((sum, step) => (settled.has(step.id) ? sum : sum + (step.tx?.value ?? 0n)), 0n);
    // L12
    if (value > 0n && (await args.gateway.getBalance(account)) - value < GAS_RESERVE_WEI) {
      throw new RunStop("gas-reserve", true);
    }
    return { steps, account, session };
  }

  const run = () => orchestrator.getRun();

  /** Stores the account's nonce with the run before the wallet is asked, so a prompt answered after the tab closed is found. */
  async function recordSend(stepId: string, account: Address) {
    if (await args.reader.hasPending(account)) throw new RunStop("pending", true);
    const nonce = await args.reader.nextNonce(account);
    orchestrator.updateSnapshot((prev) => ({ ...prev, sends: { ...prev.sends, [stepId]: { nonce, heldAt: now() } } }), {
      source: "adapter",
      durable: true,
    });
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

  /** Whether a send stored for `stepId` already landed; a send that may still land stops the run instead. */
  async function sentAlready(stepId: string, snapshot: Readonly<LiquiditySnapshot>, owner: Address) {
    const send = snapshot.sends[stepId];
    if (!send) return false;
    if (await args.reader.hasPending(owner)) throw new RunStop("pending", true);
    // with nothing pending, every send before it had mined when its nonce was read
    if ((await args.reader.nextNonce(owner)) > send.nonce) return true;
    if (now() - send.heldAt < SEND_HOLD_MS) throw new RunStop("held", true);
    forget(stepId);
    return false;
  }

  function sequentialStep(id: string): TxStep<LiquiditySnapshot, LiquidityCtx> {
    return {
      id,
      label: id,
      canSkip: (ctx, snapshot) => sentAlready(id, snapshot, ctx.owner),
      build: async (_ctx, snapshot) => {
        const settled = new Set(settledEntries(run()?.steps ?? []).map((entry) => entry.stepId));
        const { steps, account, session } = await checkedSteps(snapshot.request, settled);
        const step = steps.find((each) => each.id === id);
        if (!step) throw new RunStop("unknown", false);
        let tx: FlowTx;
        if (step.tx) tx = step.tx;
        else {
          const tokenId = snapshot.minted[step.withdraws];
          if (tokenId === undefined) throw new RunStop("unknown", false);
          await assertHolds(tokenId, account);
          tx = step.build({ tokenId });
          assertListed({ tx, session, owner: snapshot.request.input.owner, from: account });
        }
        await recordSend(id, account);
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
  async function batchLanded(snapshot: Readonly<LiquiditySnapshot>) {
    if (snapshot.callsId === undefined) return false;
    const { status } = await callsStatus(snapshot.callsId);
    if (status < 200) throw new RunStop("pending", true);
    if (status < 300) return true;
    throw new RunStop("batch-failed", false);
  }

  const batchStep: TxStep<LiquiditySnapshot, LiquidityCtx> = {
    id: BATCH,
    label: BATCH,
    canSkip: (_ctx, snapshot) => batchLanded(snapshot),
    build: async (_ctx, snapshot) => {
      const { steps, account } = await checkedSteps(snapshot.request);
      const calls = steps.map((step) => step.tx);
      if (!calls.every((tx) => tx !== undefined)) throw new RunStop("unknown", false);
      const id = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      orchestrator.updateSnapshot({ callsId: id }, { source: "adapter", durable: true });
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
    sendTransaction(tx, options) {
      const sent = batch;
      batch = undefined;
      return sent ? sendBatch(sent, options?.signal) : args.gateway.sendTransaction(tx, options);
    },
  };

  const orchestrator = createTxOrchestrator<LiquiditySnapshot, LiquidityCtx>({
    adapterId: "liquidity-flow",
    gateway,
    store: args.store,
    now: args.now,
    hooks: {
      afterStep: ({ ctx, completed, receipt }) => {
        const list = LIQUIDITY_ALLOW_LIST[ctx.chainId];
        if (!receipt || !list || !dustIds.has(completed.stepId)) return;
        const tokenId = mintedTokenId(receipt, list.positionManager);
        if (tokenId === undefined) return;
        return { snapshotPatch: (prev) => ({ ...prev, minted: { ...prev.minted, [completed.stepId]: tokenId } }) };
      },
    },
    classifyError: (error) => {
      if (error instanceof UnlistedTxError) error = new RunStop("unlisted", false);
      if (error instanceof StorageWriteError) error = new RunStop("storage", true);
      if (error instanceof RunStop) {
        stopped = error;
        return error.retryable ? "rpc" : "unknown";
      }
      return classifyTxError(error);
    },
  });

  let cached: LiquidityProgress = { stage: "idle" };

  function stage(): LiquidityProgress["stage"] {
    if (moved) return "moved";
    if (failure) return "halted";
    if (recovering) return "confirming";
    if (reviewing) return "review";
    const current = run();
    if (!current) return preparing ? "signing" : "idle";
    switch (current.status) {
      case "completed":
        return "complete";
      case "running":
        return currentEntry(current.steps)?.outcome.status === "submitted" ? "confirming" : "signing";
      default:
        return "halted";
    }
  }

  function notify() {
    cached = { stage: stage(), ...(failure ? { failure } : {}) };
    for (const listener of listeners) listener();
  }

  function report(reason: LiquidityFailureReason | undefined, retry?: () => void) {
    failure = reason === undefined ? undefined : { reason, retryable: Boolean(retry) };
    retryFailed = reason === undefined ? undefined : retry;
    notify();
  }

  function stop(error: unknown, retry: () => void) {
    if (error instanceof UnlistedTxError) error = new RunStop("unlisted", false);
    if (!(error instanceof RunStop)) {
      report(classifyTxError(error), retry);
      return;
    }
    if (error.reason === "moved") {
      moved = true;
      notify();
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
    const cause = current?.status === "paused" || current?.status === "failed" ? current.error?.cause : undefined;
    if (raised) stop(raised, resumeRun);
    else report(cause ?? "unknown", paused ? resumeRun : undefined);
  }

  orchestrator.subscribe(notify);
  // a refused prompt sent nothing, so a later use of its nonce is not this step's
  orchestrator.on("step:failed", ({ stepId, error }) => {
    if (error.cause === "rejected") forget(stepId);
  });
  orchestrator.on("flow:paused", () => halt(true));
  orchestrator.on("flow:failed", () => halt(false));

  function stepsFor(snapshot: LiquiditySnapshot) {
    const plan = planned(snapshot.request);
    dustIds = new Set(plan.flatMap((step) => (step.withdraws ? [step.withdraws] : [])));
    return snapshot.atomic ? [batchStep] : plan.map((step) => sequentialStep(step.id));
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
    let checked: Awaited<ReturnType<typeof checkedSteps>>;
    let atomic: boolean;
    try {
      checked = await checkedSteps(request);
      atomic = checked.steps.every((step) => step.tx) && (await atomicReady(checked.account, checked.session.chainId));
    } finally {
      preparing = false;
    }
    if (disposed) return;
    const snapshot: LiquiditySnapshot = { request, atomic, sends: {}, minted: {} };
    await orchestrator.start({
      flowId: args.flowId,
      snapshot,
      ctx: { owner: checked.account, chainId: checked.session.chainId },
      steps: stepsFor(snapshot),
    });
  });

  /** A stored run is restored only for the account that started it, and held for review: nothing is signed until resume. */
  function recoverRun() {
    const stored = args.store.load<LiquiditySnapshot, LiquidityCtx>(args.flowId);
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

  return {
    start() {
      if (busy() || orchestrator.getStatus() !== "idle") return;
      // a stored run may have sends on chain already
      if (args.store.load(args.flowId)) {
        recoverRun();
        return;
      }
      moved = false;
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

    /** Forgets this account's run unless it holds a send that may still land. */
    reset() {
      if (busy() || orchestrator.getStatus() === "running") return;
      const stored = run() ?? args.store.load<LiquiditySnapshot, LiquidityCtx>(args.flowId);
      if (stored) {
        const account = args.account();
        const live = stored.steps.filter(
          (step) => step.outcome.status !== "confirmed" && step.outcome.status !== "skipped",
        );
        const outstanding =
          stored.snapshot.callsId !== undefined ||
          live.some((step) => step.outcome.status === "submitted" || stored.snapshot.sends[step.stepId]);
        if (outstanding) return;
        if (account && isAddressEqual(stored.ctx.owner, account)) orchestrator.trash(args.flowId);
      }
      moved = false;
      reviewing = false;
      report(undefined);
    },

    dispose() {
      disposed = true;
      orchestrator.dispose();
    },

    getProgress: (): LiquidityProgress => cached,

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export type LiquidityDriver = ReturnType<typeof createLiquidityRun>;

import type { BalanceTxGateway, FlowRunStorage, FlowTx } from "@foresight/tx-orchestrator";
import { createMemoryStorage } from "@foresight/tx-orchestrator";
import { isAddressEqual, numberToHex, UserRejectedRequestError, type Address, type Hash, type Hex } from "viem";
import type { TransactionReceipt } from "viem";

/**
 * Fakes for the redeem run driver: one Gnosis chain shared by every tab of a test, the connected wallet's
 * one-by-one door, and its EIP-5792 provider. They follow the liquidity driver's fakes
 * (`features/liquidity/run/__tests__/support/world.ts`), trimmed to what a redeem run asks.
 */

/** What the wallet does with the n-th prompt (from 0): mine it, refuse it with 4001, or never answer. */
export type PromptScript = "sign" | "reject" | "hang";

/** An account's send at one nonce, as the liquidity reader's `sentWithNonce` answers it. */
export type SentWithNonce =
  | { status: "mined"; hash: Hash; to: Address; input: Hex; value: bigint }
  | { status: "pending" }
  | { status: "none" }
  | { status: "taken" };

export interface Broadcast {
  hash: Hash;
  tx: FlowTx;
  from: Address;
  nonce: number;
  mined: boolean;
  minedIn?: bigint;
}

export interface SendCallsRequest {
  version?: string;
  id?: string;
  chainId: Hex;
  from?: Address;
  atomicRequired: boolean;
  calls: { to: Address; data?: Hex; value?: Hex }[];
}

const BLOCK_HASH: Hash = `0x${"b".repeat(64)}`;
const hashAt = (index: number): Hash => `0x${(index + 1).toString(16).padStart(64, "0")}`;

export function chain() {
  const state = { block: 19_000_000n, native: 10n ** 30n };
  const broadcasts: Broadcast[] = [];
  /** Atomic batches by the id they were sent under, so a reloaded tab's wallet can report on them. */
  const batches = new Map<string, Broadcast>();
  const waiting = new Map<Hash, (receipt: TransactionReceipt) => void>();

  const receiptOf = (sent: Broadcast): TransactionReceipt => ({
    blockHash: BLOCK_HASH,
    blockNumber: sent.minedIn ?? state.block,
    transactionHash: sent.hash,
    contractAddress: null,
    cumulativeGasUsed: 21_000n,
    effectiveGasPrice: 1n,
    from: sent.from,
    gasUsed: 21_000n,
    logs: [],
    logsBloom: `0x${"0".repeat(512)}`,
    status: "success",
    to: sent.tx.to,
    transactionIndex: 0,
    type: "eip1559",
  });

  const ofAccount = (account: Address) => broadcasts.filter((sent) => isAddressEqual(sent.from, account));
  const counts = (account: Address) => {
    const sends = ofAccount(account);
    return { mined: sends.filter((sent) => sent.mined).length, pending: sends.length };
  };

  function mine(sent: Broadcast) {
    if (sent.mined) return;
    sent.mined = true;
    state.block += 1n;
    sent.minedIn = state.block;
    waiting.get(sent.hash)?.(receiptOf(sent));
    waiting.delete(sent.hash);
  }

  function broadcast(tx: FlowTx, from: Address, mined: boolean): Broadcast {
    const sent: Broadcast = { hash: hashAt(broadcasts.length), tx, from, nonce: ofAccount(from).length, mined: false };
    broadcasts.push(sent);
    if (mined) mine(sent);
    return sent;
  }

  const find = (hash: Hash) => broadcasts.find((sent) => sent.hash === hash);

  const reader = {
    nextNonce: (account: Address) => Promise.resolve(counts(account).mined),
    hasPending: (account: Address) => {
      const { mined, pending } = counts(account);
      return Promise.resolve(pending > mined);
    },
    blockNumber: () => Promise.resolve(state.block),
    sentWithNonce: ({ owner, nonce, fromBlock }: { owner: Address; nonce: number; fromBlock: bigint }) => {
      const { mined, pending } = counts(owner);
      if (mined <= nonce) return Promise.resolve<SentWithNonce>({ status: pending > nonce ? "pending" : "none" });
      const sent = ofAccount(owner).find((each) => each.mined && each.nonce === nonce);
      return Promise.resolve<SentWithNonce>(
        !sent || sent.minedIn! < fromBlock
          ? { status: "taken" }
          : {
              status: "mined",
              hash: sent.hash,
              to: sent.tx.to,
              input: sent.tx.data ?? "0x",
              value: sent.tx.value ?? 0n,
            },
      );
    },
  };

  return {
    state,
    reader,
    broadcasts,
    batches,
    broadcast,
    /** Broadcasts and mines `tx` outside any driver: a prompt the visitor approved after its tab closed. */
    approveLater: (tx: FlowTx, from: Address) => broadcast(tx, from, true),
    /** Mines every broadcast transaction still waiting. */
    land: () => broadcasts.forEach(mine),
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

/** The connected wallet's one-by-one door; `script(n, tx)` decides the n-th prompt. */
export function gateway(
  world: Chain,
  from: Address,
  opts: { script?: (index: number, tx: FlowTx) => PromptScript } = {},
) {
  const prompts: FlowTx[] = [];
  const hung: FlowTx[] = [];
  let onHang: (() => void) | undefined;

  const port: BalanceTxGateway = {
    sendTransaction: (tx) => {
      const index = prompts.length;
      prompts.push(tx);
      const step = opts.script?.(index, tx) ?? "sign";
      if (step === "reject") {
        return Promise.reject(new UserRejectedRequestError(new Error("User rejected the request.")));
      }
      if (step === "hang") {
        hung.push(tx);
        onHang?.();
        return new Promise<Hash>(() => {});
      }
      return Promise.resolve(world.broadcast(tx, from, true).hash);
    },
    waitForReceipt: ({ hash }) => world.waitFor(hash),
    getReceipt: (hash) => {
      const sent = world.find(hash);
      return Promise.resolve(sent?.mined ? world.receiptOf(sent) : null);
    },
    isKnown: (hash) => Promise.resolve(Boolean(world.find(hash))),
    getBalance: () => Promise.resolve(world.state.native),
    estimateFee: () => Promise.resolve(0n),
  };

  return {
    port,
    prompts,
    hung,
    /** Resolves once a prompt is held open. */
    held: () => new Promise<void>((resolve) => (hung.length > 0 ? resolve() : (onHang = resolve))),
  };
}

/** A raw EIP-1193 provider answering the three EIP-5792 methods, shaped as the EIP gives them. */
export function wallet(
  world: Chain,
  from: Address,
  opts: {
    atomic?: boolean;
    /** `unmined`: the wallet answers and broadcasts the batch, which mines on `land()`. */
    sendCalls?: "answer" | "unmined";
    /** The first wallet_sendCalls is answered with an error of this code, broadcasting nothing. */
    sendCallsRefuse?: number;
    onSendCalls?: (params: SendCallsRequest) => void;
  } = {},
) {
  const sendCalls: SendCallsRequest[] = [];
  let onSend: (() => void) | undefined;

  const request = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
    switch (method) {
      case "eth_chainId":
        return "0x64";
      case "eth_accounts":
      case "eth_requestAccounts":
        return [from];
      case "wallet_getCapabilities":
        return { "0x64": opts.atomic ? { atomic: { status: "supported" } } : {} };
      case "wallet_sendCalls": {
        const [call] = params as [SendCallsRequest];
        sendCalls.push(call);
        opts.onSendCalls?.(call);
        onSend?.();
        if (opts.sendCallsRefuse !== undefined && sendCalls.length === 1) {
          throw Object.assign(new Error("User rejected the request."), { code: opts.sendCallsRefuse });
        }
        // an atomic batch lands as one transaction
        const sent = world.broadcast({ to: from, data: "0x" }, from, opts.sendCalls !== "unmined");
        world.batches.set(call.id ?? "", sent);
        return { id: call.id };
      }
      case "wallet_getCallsStatus": {
        const [id] = params as [string];
        const sent = world.batches.get(id);
        if (!sent) throw Object.assign(new Error("Unknown bundle id"), { code: 5730 });
        if (!sent.mined) return { version: "2.0.0", id, chainId: "0x64", status: 100, atomic: true };
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
    sendCalls,
    sent: () => new Promise<void>((resolve) => (sendCalls.length > 0 ? resolve() : (onSend = resolve))),
  };
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

const sameTx = (a: FlowTx, b: FlowTx) =>
  isAddressEqual(a.to, b.to) && (a.data ?? "0x") === (b.data ?? "0x") && (a.value ?? 0n) === (b.value ?? 0n);

/** How many times each of `txs` reached the chain one by one, mined or still broadcast. */
export const timesBroadcast = (world: Chain, txs: readonly FlowTx[]) =>
  txs.map((tx) => world.broadcasts.filter((sent) => sameTx(sent.tx, tx)).length);

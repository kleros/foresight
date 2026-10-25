import { createFlowRunStore, createMemoryStorage, type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import { decodeFunctionData, erc20Abi, type Hash, type PublicClient, type TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addresses,
  chainState,
  ctx,
  fakeQuoter,
  fakeReader,
  gasLimitFor,
  landedTx,
  option,
  snapshot,
  WAD,
} from "@/features/predict/flow/__tests__/support/fakes";
import type { PredictCtx, PredictSnapshot, SentTx } from "@/features/predict/flow/types";
import { createPredictRun } from "@/features/predict/run/driver";
import { createPredictReader } from "@/features/predict/run/reader";
import type { PredictDriver } from "@/features/predict/run/types";

vi.mock("@/features/predict/api/getOptionPools", () => ({ fetchSessionPools: vi.fn(), optionPoolRefs: vi.fn() }));

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;
const receipt = (target: Hash, blockNumber = 20n) =>
  ({ transactionHash: target, status: "success", blockNumber, logs: [] }) as unknown as TransactionReceipt;
const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});
const other: FlowTx = { to: addresses.owner, data: "0x", value: 0n };

describe("unresolved send retention", () => {
  it("retains a second batch journal when the nonce search is exhausted", async () => {
    const flowId = "retention-eight-nonces";
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const sends: FlowTx[] = [];
    const ledger: Array<{ tx: FlowTx; hash: Hash; block?: bigint }> = [];
    const inspected: number[] = [];
    let head = 1n;
    const append = (tx: FlowTx, mined: boolean) => {
      const entry = { tx, hash: hash(ledger.length + 1), ...(mined ? { block: ++head } : {}) };
      ledger.push(entry);
      return entry.hash;
    };
    const client = {
      getTransactionCount: ({ blockTag, blockNumber }: { blockTag?: string; blockNumber?: bigint }) =>
        Promise.resolve(
          blockTag === "pending"
            ? ledger.length
            : ledger.filter((tx) => tx.block !== undefined && tx.block <= (blockNumber ?? head)).length,
        ),
      getBlockNumber: () => Promise.resolve(head),
      getBlock: ({ blockNumber }: { blockNumber: bigint }) =>
        Promise.resolve({
          number: blockNumber,
          transactions: ledger.flatMap((entry, nonce) =>
            entry.block === blockNumber
              ? [
                  {
                    from: addresses.owner,
                    nonce,
                    hash: entry.hash,
                    to: entry.tx.to,
                    value: entry.tx.value ?? 0n,
                    input: entry.tx.data ?? "0x",
                  },
                ]
              : [],
          ),
        }),
      getTransactionReceipt: ({ hash: target }: { hash: Hash }) => Promise.resolve(receipt(target)),
    } as unknown as PublicClient;
    const nodes = createPredictReader({ client, sessionId: "1", collateral: addresses.collateral });
    const gateway: TxGateway = {
      sendTransaction: async (tx) => {
        sends.push(tx);
        if (sends.length === 3) {
          // The second batch's prompt stays open while the same owner uses another dapp.
          for (let i = 0; i < 8; i++) append(other, true);
          append(tx, false);
          throw new Error("Transaction failed", {
            cause: Object.assign(new Error("Internal JSON-RPC error"), { code: -32603 }),
          });
        }
        if (sends.length === 4) {
          return append(tx, false);
        }
        return append(tx, true);
      },
      waitForReceipt: async ({ hash: target }) =>
        ledger.find((entry) => entry.hash === target)?.block === undefined ? new Promise(() => {}) : receipt(target),
      getReceipt: async (target) => receipt(target),
      isKnown: async () => true,
    };
    const reader = {
      ...fakeReader({ deployed: true, blockGasLimit: gasLimitFor(1), state: () => chainState({ underlying: WAD }) }),
      latestBlock: async () => head,
      nextNonce: nodes.nextNonce,
      hasPending: nodes.hasPending,
      sentWithNonce: async (args: Parameters<typeof nodes.sentWithNonce>[0]) => {
        inspected.push(args.nonce);
        return nodes.sentWithNonce(args);
      },
      landedSince: async () => ledger.filter((tx) => tx.block !== undefined).map(({ tx }) => landedTx(tx)),
    };
    const driver = createPredictRun({
      gateway,
      reader,
      quoter: fakeQuoter(),
      flowId,
      store,
      ctx: () => ctx(),
      snapshot: () => snapshot({ options: [option(1), option(2)] }),
      unansweredSend: { waitMs: 0, pollMs: 1 },
    });
    drivers.push(driver);
    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    expect(inspected).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(await nodes.sentWithNonce({ owner: addresses.owner, nonce: 10, fromBlock: 3n })).toEqual({
      status: "pending",
    });
    expect(await reader.hasPending(addresses.owner)).toBe(true);
    expect(store.load<PredictSnapshot, PredictCtx>(flowId)?.snapshot.unanswered?.["predict-2"]).toBeDefined();
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("pending"));
    expect(sends).toHaveLength(3);
    expect(ledger[10]?.block).toBeUndefined();
    expect(store.load(flowId)).not.toBeNull();
    ledger[10]!.block = ++head;
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));
    expect(sends).toHaveLength(3);
    expect(inspected).toContain(10);
  });

  it("reconciles Discard without erasing an unresolved deposit", async () => {
    const flowId = "retention-discard-live-deposit";
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const sends: FlowTx[] = [];
    let surfaced = false;
    let mined = false;
    const nonceReads = vi.fn(async (): Promise<SentTx> =>
      mined
        ? { status: "mined", hash: hash(1), success: true, ...landedTx(sends[0]!) }
        : { status: surfaced ? "pending" : "none" },
    );
    const gateway: TxGateway = {
      sendTransaction: async (tx) => {
        sends.push(tx);
        return hash(sends.length);
      },
      waitForReceipt: async ({ hash: target }) => {
        if (mined) return receipt(target);
        throw new Error("unavailable", { cause: "opaque" });
      },
      getReceipt: vi.fn(async (target) => (mined ? receipt(target) : null)),
      isKnown: vi.fn(async () => surfaced),
    };
    const driver = createPredictRun({
      gateway,
      reader: {
        ...fakeReader({ deployed: true }),
        sentWithNonce: nonceReads,
        hasPending: async () => surfaced && !mined,
        collateralBalance: async () => (mined ? WAD : 0n),
      },
      quoter: fakeQuoter(),
      flowId,
      store,
      ctx: () => ctx(),
      snapshot: () => snapshot(),
    });
    drivers.push(driver);
    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().pendingHash).toBe(hash(1)));
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("unseen"));
    surfaced = true;
    expect(await nonceReads()).toEqual({ status: "pending" });
    const reads = vi.mocked(gateway.getReceipt).mock.calls.length;
    driver.discard();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("pending"));
    expect(vi.mocked(gateway.getReceipt).mock.calls.length).toBeGreaterThan(reads);
    expect(store.load(flowId)).not.toBeNull();
    expect(driver.getProgress().pendingHash).toBe(hash(1));
    expect(sends).toHaveLength(1);
    mined = true;
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));
    expect(sends.filter((tx) => tx.to === addresses.collateral)).toHaveLength(1);
  });

  it("retains an unresolved deposit prompt after session close", async () => {
    const flowId = "retention-close-live-deposit";
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const closesAt = 1_800_000_000;
    let timestamp = BigInt(closesAt - 5);
    let paid = 0n;
    let approve: (() => void) | undefined;
    const sends: FlowTx[] = [];
    const gateway: TxGateway = {
      sendTransaction: (tx) => {
        sends.push(tx);
        return new Promise((resolve) => {
          approve = () => {
            const transfer = decodeFunctionData({ abi: erc20Abi, data: tx.data! });
            expect(transfer.functionName).toBe("transfer");
            if (transfer.functionName !== "transfer") throw new Error("not a transfer");
            expect(transfer.args[0]).toBe(addresses.executor);
            paid += transfer.args[1];
            resolve(hash(1));
          };
        });
      },
      waitForReceipt: async ({ hash: target }) => receipt(target),
      getReceipt: async () => null,
      isKnown: async () => false,
    };
    const reader = {
      ...fakeReader({ deployed: true }),
      latestTimestamp: async () => timestamp,
      collateralBalance: async () => paid,
    };
    const open = () => {
      const driver = createPredictRun({
        gateway,
        reader,
        quoter: fakeQuoter(),
        flowId,
        store,
        ctx: () => ctx(),
        snapshot: () => snapshot(),
        closesAt,
        now: () => Number(timestamp) * 1000,
      });
      drivers.push(driver);
      return driver;
    };
    const first = open();
    first.start();
    await vi.waitFor(() => expect(approve).toBeDefined());
    expect(store.load<PredictSnapshot, PredictCtx>(flowId)?.snapshot.unanswered?.deposit).toBeDefined();
    first.dispose();
    timestamp = BigInt(closesAt + 1);
    const second = open();
    second.recover();
    await vi.waitFor(() => expect(second.getProgress().failure?.reason).toBe("held"));
    expect(second.getProgress().unanswered).toBe(true);
    second.reset();
    expect(store.load(flowId)).not.toBeNull();
    approve!();
    await Promise.resolve();
    expect(sends).toHaveLength(1);
    expect(sends[0]?.to).toBe(addresses.collateral);
    expect(paid).toBe(WAD);
    const third = open();
    third.recover();
    await vi.waitFor(() => expect(third.getProgress().failure?.reason).toBe("held"));
    expect(store.load(flowId)).not.toBeNull();
  });
});

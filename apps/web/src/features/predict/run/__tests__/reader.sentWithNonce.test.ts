import type { Address, Hash, PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

import { createPredictReader } from "../reader";

// the indexer's client reads the app's environment, and no nonce read goes near it
vi.mock("../../api/getOptionPools", () => ({ fetchSessionPools: vi.fn(), optionPoolRefs: vi.fn() }));

const OWNER = "0x0000000000000000000000000000000000000001" as Address;
const TARGET = "0x0000000000000000000000000000000000000002" as Address;

/** A chain of `head` blocks where the owner's nonces are mined at the blocks `minedAt` gives. */
function chainClient(head: bigint, minedAt: Record<number, bigint>) {
  const blocksRead: bigint[] = [];
  const countAt = (block: bigint) => Object.values(minedAt).filter((at) => at <= block).length;
  const client = {
    getTransactionCount: ({ blockTag, blockNumber }: { blockTag?: string; blockNumber?: bigint }) =>
      Promise.resolve(countAt(blockNumber ?? (blockTag === "pending" || blockTag === "latest" ? head : head))),
    getBlockNumber: () => Promise.resolve(head),
    getBlock: ({ blockNumber }: { blockNumber: bigint }) => {
      blocksRead.push(blockNumber);
      const transactions = Object.entries(minedAt)
        .filter(([, at]) => at === blockNumber)
        .map(([nonce]) => ({
          from: OWNER,
          nonce: Number(nonce),
          to: TARGET,
          value: 0n,
          input: "0x",
          hash: `0x${nonce.padStart(64, "0")}` as Hash,
        }));
      return Promise.resolve({ number: blockNumber, transactions });
    },
    getTransactionReceipt: () => Promise.resolve({ status: "success" }),
  };
  return { client: client as unknown as PublicClient, blocksRead };
}

describe("createPredictReader's sentWithNonce", () => {
  it("finds a nonce mined a day back without reading every block since", async () => {
    const fromBlock = 1_000n;
    const { client, blocksRead } = chainClient(fromBlock + 17_280n, {
      0: 10n,
      1: 20n,
      2: 30n,
      3: 40n,
      4: 900n,
      5: fromBlock + 2n,
    });
    const reader = createPredictReader({ client, sessionId: "1", collateral: TARGET });

    const found = await reader.sentWithNonce({ owner: OWNER, nonce: 5, fromBlock });

    expect(found).toMatchObject({ status: "mined", to: TARGET, success: true });
    expect(blocksRead).toEqual([fromBlock + 2n]);
  });

  it("still finds it on a node that keeps no past state, block by block", async () => {
    const { client, blocksRead } = chainClient(1_010n, { 0: 10n, 1: 1_004n });
    const pruned = {
      ...client,
      getTransactionCount: (args: { blockNumber?: bigint }) =>
        args.blockNumber === undefined
          ? client.getTransactionCount(args as never)
          : Promise.reject(new Error("missing trie node")),
    } as unknown as PublicClient;
    const reader = createPredictReader({ client: pruned, sessionId: "1", collateral: TARGET });

    expect(await reader.sentWithNonce({ owner: OWNER, nonce: 1, fromBlock: 1_000n })).toMatchObject({
      status: "mined",
    });
    expect(blocksRead.at(-1)).toBe(1_004n);
  });

  it("calls a nonce mined before the run's first block taken", async () => {
    const { client } = chainClient(2_000n, { 0: 10n, 1: 999n });
    const reader = createPredictReader({ client, sessionId: "1", collateral: TARGET });

    expect(await reader.sentWithNonce({ owner: OWNER, nonce: 1, fromBlock: 1_000n })).toEqual({ status: "taken" });
  });
});

describe("createPredictReader's nonce reads through the wallet's provider", () => {
  const walletCounts = (latest: number, pending: number) =>
    vi.fn((_owner: Address, blockTag: "latest" | "pending") =>
      Promise.resolve(blockTag === "latest" ? latest : pending),
    );

  it("reads the next nonce from the wallet's node when it has one", async () => {
    const { client } = chainClient(100n, { 0: 10n });
    const walletNonce = walletCounts(1, 3);
    const reader = createPredictReader({ client, sessionId: "1", collateral: TARGET, walletNonce });

    expect(await reader.nextNonce(OWNER)).toBe(3);
    expect(walletNonce).toHaveBeenCalledWith(OWNER, "pending");
  });

  it("sees a send pending on the wallet's node that the app's node does not know", async () => {
    const { client } = chainClient(100n, { 0: 10n });
    const reader = createPredictReader({ client, sessionId: "1", collateral: TARGET, walletNonce: walletCounts(1, 2) });

    expect(await reader.sentWithNonce({ owner: OWNER, nonce: 1, fromBlock: 50n })).toEqual({ status: "pending" });
    expect(await reader.hasPending(OWNER)).toBe(true);
  });

  it("calls a nonce the wallet's node has mined, but the app's node has not reached, pending rather than taken", async () => {
    const { client } = chainClient(100n, { 0: 10n });
    const reader = createPredictReader({ client, sessionId: "1", collateral: TARGET, walletNonce: walletCounts(2, 2) });

    expect(await reader.sentWithNonce({ owner: OWNER, nonce: 1, fromBlock: 50n })).toEqual({ status: "pending" });
  });

  it("counts what the app's node has mined when the wallet's node is behind it", async () => {
    const { client } = chainClient(100n, { 0: 10n, 1: 60n });
    const reader = createPredictReader({ client, sessionId: "1", collateral: TARGET, walletNonce: walletCounts(1, 1) });

    expect(await reader.nextNonce(OWNER)).toBe(2);
    expect(await reader.sentWithNonce({ owner: OWNER, nonce: 1, fromBlock: 50n })).toMatchObject({ status: "mined" });
    expect(await reader.hasPending(OWNER)).toBe(false);
  });

  it("reads from the app's node when the wallet's read fails", async () => {
    const { client } = chainClient(100n, { 0: 10n });
    const walletNonce = vi.fn(() => Promise.reject(new Error("method not supported")));
    const reader = createPredictReader({ client, sessionId: "1", collateral: TARGET, walletNonce });

    expect(await reader.nextNonce(OWNER)).toBe(1);
    expect(await reader.sentWithNonce({ owner: OWNER, nonce: 1, fromBlock: 50n })).toEqual({ status: "none" });
  });
});

import { createPublicClient, custom, numberToHex, type Address, type Hash, type Hex } from "viem";
import { gnosis } from "viem/chains";
import { describe, expect, it } from "vitest";

import { readSentWithNonce } from "../sentWithNonce";

const OWNER: Address = "0x00000000000000000000000000000000000000a1";
const TARGET: Address = "0x00000000000000000000000000000000000000c7";
const INPUT: Hex = "0xdeadbeef";
const STRANGER: Address = "0x00000000000000000000000000000000000000f6";
const STRANGER_HASH: Hash = `0x${"f".repeat(64)}`;

const hashOf = (nonce: number): Hash => `0x${(nonce + 1).toString(16).padStart(64, "0")}`;

/**
 * A node, as JSON-RPC: the owner's nonces mined at the blocks `minedAt` gives, `broadcast` more waiting.
 * No library builds a node's side of these methods, so the shapes follow the Ethereum JSON-RPC spec.
 */
function node(opts: {
  head: bigint;
  minedAt: Record<number, bigint>;
  broadcast?: number;
  pruned?: boolean;
  /** Another account's transactions, listed in their block ahead of the owner's. */
  others?: { nonce: number; block: bigint }[];
}) {
  const blocksRead: bigint[] = [];
  const countAfter = (block: bigint) => Object.values(opts.minedAt).filter((at) => at <= block).length;
  const request = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
    const args = (params ?? []) as unknown[];
    switch (method) {
      case "eth_chainId":
        return numberToHex(gnosis.id);
      case "eth_blockNumber":
        return numberToHex(opts.head);
      case "eth_getTransactionCount": {
        const tag = args[1] as string;
        if (tag === "pending") return numberToHex(countAfter(opts.head) + (opts.broadcast ?? 0));
        if (tag === "latest") return numberToHex(countAfter(opts.head));
        if (opts.pruned) throw Object.assign(new Error("missing trie node"), { code: -32000 });
        return numberToHex(countAfter(BigInt(tag)));
      }
      case "eth_getBlockByNumber": {
        const number = BigInt(args[0] as string);
        blocksRead.push(number);
        const sent = [
          ...(opts.others ?? []).filter((each) => each.block === number).map((each) => ({ ...each, from: STRANGER })),
          ...Object.entries(opts.minedAt)
            .filter(([, at]) => at === number)
            .map(([nonce, block]) => ({ nonce: Number(nonce), block, from: OWNER })),
        ];
        const transactions = sent.map(({ nonce, from }) => ({
          hash: from === OWNER ? hashOf(nonce) : STRANGER_HASH,
          from,
          to: TARGET,
          nonce: numberToHex(nonce),
          input: INPUT,
          value: "0x7",
          gas: "0x5208",
          gasPrice: "0x1",
          blockHash: `0x${"b".repeat(64)}`,
          blockNumber: numberToHex(number),
          transactionIndex: "0x0",
          type: "0x0",
          chainId: numberToHex(gnosis.id),
          v: "0x1b",
          r: `0x${"1".repeat(64)}`,
          s: `0x${"2".repeat(64)}`,
        }));
        return {
          number: numberToHex(number),
          hash: `0x${number.toString(16).padStart(64, "0")}`,
          parentHash: `0x${"0".repeat(64)}`,
          timestamp: "0x1",
          gasLimit: "0x1",
          gasUsed: "0x0",
          miner: TARGET,
          extraData: "0x",
          logsBloom: `0x${"0".repeat(512)}`,
          transactions,
        };
      }
      default:
        throw new Error(`unexpected rpc ${method}`);
    }
  };
  return { client: createPublicClient({ chain: gnosis, transport: custom({ request }) }), blocksRead };
}

describe("readSentWithNonce", () => {
  it("finds the call a nonce mined a day back made, reading only the block that mined it", async () => {
    const fromBlock = 1_000n;
    const { client, blocksRead } = node({
      head: fromBlock + 17_280n,
      minedAt: { 0: 10n, 1: 20n, 2: 900n, 3: fromBlock + 2n },
    });

    const found = await readSentWithNonce(client, { owner: OWNER, nonce: 3, fromBlock });

    expect(found).toEqual({ status: "mined", hash: hashOf(3), to: TARGET, input: INPUT, value: 7n });
    expect(blocksRead).toEqual([fromBlock + 2n]);
  });

  it("finds it block by block on a node that keeps no past state", async () => {
    const { client } = node({ head: 1_010n, minedAt: { 0: 10n, 1: 1_004n }, pruned: true });

    expect(await readSentWithNonce(client, { owner: OWNER, nonce: 1, fromBlock: 1_000n })).toMatchObject({
      status: "mined",
      hash: hashOf(1),
    });
  });

  it("calls a nonce mined before the block looked from taken", async () => {
    const { client } = node({ head: 2_000n, minedAt: { 0: 10n, 1: 999n } });

    expect(await readSentWithNonce(client, { owner: OWNER, nonce: 1, fromBlock: 1_000n })).toEqual({ status: "taken" });
  });

  it("calls a nonce broadcast and not yet mined pending", async () => {
    const { client } = node({ head: 2_000n, minedAt: { 0: 10n }, broadcast: 1 });

    expect(await readSentWithNonce(client, { owner: OWNER, nonce: 1, fromBlock: 1_000n })).toEqual({
      status: "pending",
    });
  });

  it("calls a nonce nothing used yet none", async () => {
    const { client } = node({ head: 2_000n, minedAt: { 0: 10n } });

    expect(await readSentWithNonce(client, { owner: OWNER, nonce: 1, fromBlock: 1_000n })).toEqual({ status: "none" });
  });

  it("finds the owner's call when another account's transaction at the same nonce shares its block", async () => {
    const { client } = node({ head: 2_000n, minedAt: { 0: 10n, 1: 1_004n }, others: [{ nonce: 1, block: 1_004n }] });

    expect(await readSentWithNonce(client, { owner: OWNER, nonce: 1, fromBlock: 1_000n })).toMatchObject({
      status: "mined",
      hash: hashOf(1),
    });
  });

  it("finds the call at its own nonce when the owner mined two in one block", async () => {
    const { client } = node({ head: 2_000n, minedAt: { 0: 10n, 1: 1_004n, 2: 1_004n } });

    expect(await readSentWithNonce(client, { owner: OWNER, nonce: 2, fromBlock: 1_000n })).toMatchObject({
      status: "mined",
      hash: hashOf(2),
    });
  });

  it("finds a call mined in the latest block", async () => {
    const { client } = node({ head: 1_004n, minedAt: { 0: 10n, 1: 1_004n } });

    expect(await readSentWithNonce(client, { owner: OWNER, nonce: 1, fromBlock: 1_000n })).toMatchObject({
      status: "mined",
      hash: hashOf(1),
    });
  });
});

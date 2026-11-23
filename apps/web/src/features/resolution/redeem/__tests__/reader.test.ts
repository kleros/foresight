import { erc20Abi, type Address, type PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

import { createRedeemReader } from "../reader";

const OWNER: Address = "0x00000000000000000000000000000000000000a1";
const TOKEN: Address = "0x00000000000000000000000000000000000000d1";

/** A node that answers an account's mined (`latest`) and broadcast (`pending`) transaction counts. */
function node(counts: { latest: number; pending: number }) {
  const readContract = vi.fn(async () => 7n);
  const client = {
    getTransactionCount: async ({ blockTag }: { blockTag: "latest" | "pending" }) => counts[blockTag],
    getBlockNumber: async () => 19_000_000n,
    readContract,
  } as unknown as PublicClient;
  return { client, readContract };
}

describe("createRedeemReader", () => {
  it("reports nothing pending while every broadcast send has mined", async () => {
    expect(await createRedeemReader(node({ latest: 4, pending: 4 }).client).hasPending(OWNER)).toBe(false);
  });

  it("reports a send pending while the broadcast count is ahead of the mined one", async () => {
    expect(await createRedeemReader(node({ latest: 4, pending: 5 }).client).hasPending(OWNER)).toBe(true);
  });

  it("takes the next nonce from the mined count", async () => {
    expect(await createRedeemReader(node({ latest: 4, pending: 6 }).client).nextNonce(OWNER)).toBe(4);
  });

  it("reads the head block", async () => {
    expect(await createRedeemReader(node({ latest: 0, pending: 0 }).client).blockNumber()).toBe(19_000_000n);
  });

  it("finds no send at a nonce no transaction reached", async () => {
    const reader = createRedeemReader(node({ latest: 4, pending: 4 }).client);

    expect(await reader.sentWithNonce({ owner: OWNER, nonce: 4, fromBlock: 1n })).toEqual({ status: "none" });
  });

  it("reads an ERC-20 balance of the account", async () => {
    const { client, readContract } = node({ latest: 0, pending: 0 });

    expect(await createRedeemReader(client).balanceOf(TOKEN, OWNER)).toBe(7n);
    expect(readContract).toHaveBeenCalledWith({
      address: TOKEN,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [OWNER],
    });
  });
});

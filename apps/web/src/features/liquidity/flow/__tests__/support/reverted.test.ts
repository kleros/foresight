import type { Hash } from "viem";
import { describe, expect, it } from "vitest";

import { minedHash, revertedOnChain } from "./reverted";

const HASH: Hash = `0x${"ab".repeat(32)}`;
const clientWith = (status: "success" | "reverted") => ({
  getTransactionReceipt: async ({ hash }: { hash: Hash }) => {
    expect(hash).toBe(HASH);
    return { status } as never;
  },
});
const neverAsked = {
  getTransactionReceipt: async () => {
    throw new Error("asked the chain for a receipt of a send that has no hash");
  },
};

describe("revertedOnChain", () => {
  it("is true only for a mined send whose receipt says reverted", async () => {
    expect(await revertedOnChain(clientWith("reverted"), 0, { hash: HASH })).toBe(true);
    expect(await revertedOnChain(clientWith("success"), 0, { hash: HASH })).toBe(false);
  });

  it("throws for a send that failed to broadcast, whatever the reason", async () => {
    for (const reason of ["nonce too low", "insufficient funds for gas", "fetch failed"]) {
      await expect(revertedOnChain(neverAsked, 3, { error: new Error(reason) })).rejects.toThrow(
        new RegExp(`send 3 never reached the chain: Error: ${reason}`),
      );
    }
  });

  it("throws for a send that was never recorded", async () => {
    await expect(revertedOnChain(neverAsked, 2, undefined)).rejects.toThrow("no send 2");
    await expect(revertedOnChain(neverAsked, 0, {})).rejects.toThrow("send 0 never reached the chain");
  });

  it("reads a mined revert from the hash the node put on the broadcast error", async () => {
    const error = Object.assign(new Error("execution reverted"), { cause: { data: { txHash: HASH } } });
    expect(minedHash(error)).toBe(HASH);
    expect(await revertedOnChain(clientWith("reverted"), 1, { error, hash: minedHash(error) })).toBe(true);
    expect(minedHash(new Error("nonce too low"))).toBeUndefined();
  });
});

import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  erc20Abi,
  isAddressEqual,
  numberToHex,
  type Address,
  type Hex,
} from "viem";
import { gnosis } from "viem/chains";
import { describe, expect, it, vi } from "vitest";

import { createRedeemReader } from "../redeemReader";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

const OWNER: Address = "0x00000000000000000000000000000000000000a1";
const TOKEN: Address = "0x00000000000000000000000000000000000000e0";

/** A node, as JSON-RPC: `mined` and `pending` transaction counts for OWNER, its head, and OWNER's TOKEN balance. */
function node(opts: { mined: number; pending: number; head?: bigint; balance?: bigint }) {
  const request = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
    const args = (params ?? []) as unknown[];
    switch (method) {
      case "eth_chainId":
        return numberToHex(gnosis.id);
      case "eth_blockNumber":
        return numberToHex(opts.head ?? 0n);
      case "eth_getTransactionCount":
        return numberToHex(args[1] === "pending" ? opts.pending : opts.mined);
      case "eth_call": {
        const { to, data } = args[0] as { to: Address; data: Hex };
        const { args: callArgs } = decodeFunctionData({ abi: erc20Abi, data });
        const holder = (callArgs as readonly [Address])[0];
        const held = isAddressEqual(to, TOKEN) && isAddressEqual(holder, OWNER) ? (opts.balance ?? 0n) : 0n;
        return encodeAbiParameters([{ type: "uint256" }], [held]);
      }
      default:
        throw new Error(`The fake node does not answer ${method}`);
    }
  };
  return createPublicClient({ chain: gnosis, transport: custom({ request }) });
}

describe("the connected wallet redeem's chain reader", () => {
  it("has nothing pending when every broadcast transaction mined", async () => {
    expect(await createRedeemReader(node({ mined: 4, pending: 4 })).hasPending(OWNER)).toBe(false);
  });

  it("has a send pending when more were broadcast than mined", async () => {
    expect(await createRedeemReader(node({ mined: 4, pending: 5 })).hasPending(OWNER)).toBe(true);
  });

  it("names the next nonce as the mined count", async () => {
    expect(await createRedeemReader(node({ mined: 4, pending: 5 })).nextNonce(OWNER)).toBe(4);
  });

  it("reads the head block", async () => {
    expect(await createRedeemReader(node({ mined: 0, pending: 0, head: 19_000_001n })).blockNumber()).toBe(
      19_000_001n,
    );
  });

  it("reads the account's balance of a token", async () => {
    const reader = createRedeemReader(node({ mined: 0, pending: 0, balance: 7n }));

    expect(await reader.balanceOf(TOKEN, OWNER)).toBe(7n);
  });

  it("finds no send at a nonce the account has not used", async () => {
    const reader = createRedeemReader(node({ mined: 2, pending: 2 }));

    expect(await reader.sentWithNonce({ owner: OWNER, nonce: 2, fromBlock: 0n })).toEqual({ status: "none" });
  });
});

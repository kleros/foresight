import { parseEther, type Address, type PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

import { toSessionStats } from "../../utils/toSessionStats";
import { fetchPoolBalances } from "../getPoolBalances";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: undefined }));
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));

const LOW = `0x${"01".repeat(20)}` as Address;
const HIGH = `0x${"fe".repeat(20)}` as Address;

/** A chain where `balances[token][holder]` is each ERC20 balance, read through multicall. */
function chainHolding(balances: Record<string, Record<string, bigint>>) {
  return {
    multicall: async ({ contracts }: { contracts: { address: Address; args: readonly [Address] }[] }) =>
      contracts.map(({ address, args: [holder] }) => balances[address.toLowerCase()]?.[holder.toLowerCase()] ?? 0n),
  } as unknown as PublicClient;
}

describe("a pool's side and balances", () => {
  it("come from the indexer's outcomeIndex and token addresses, whichever token sorts first", async () => {
    const row = {
      childMarket_id: "0xc1",
      underlyingPerOutcome: null,
      volumeUnderlying: "0",
      volumeOutcome: "0",
    };
    // pool 0xa1: the outcome token sorts first (token0); pool 0xa2: it sorts second (token1)
    const stats = toSessionStats({
      Prediction: [],
      Pool: [
        { ...row, id: "0xA1", outcomeIndex: 0, outcomeToken: LOW, underlyingToken: HIGH },
        { ...row, id: "0xA2", outcomeIndex: 1, outcomeToken: HIGH, underlyingToken: LOW },
      ],
    });
    const client = chainHolding({
      [LOW]: { "0xa1": parseEther("7"), "0xa2": parseEther("2") },
      [HIGH]: { "0xa1": parseEther("3"), "0xa2": parseEther("11") },
    });

    const balances = await fetchPoolBalances(client, stats.pools);

    expect(stats.pools.map(({ id, side }) => [id, side])).toEqual([
      ["0xa1", "DOWN"],
      ["0xa2", "UP"],
    ]);
    expect(balances).toEqual({
      "0xa1": { outcome: parseEther("7"), underlying: parseEther("3") },
      "0xa2": { outcome: parseEther("11"), underlying: parseEther("2") },
    });
  });

  it("takes the side from outcomeIndex alone, not from which token sorts first", () => {
    const row = { childMarket_id: "0xc1", underlyingPerOutcome: null, volumeUnderlying: "0", volumeOutcome: "0" };
    const stats = toSessionStats({
      Prediction: [],
      Pool: [
        { ...row, id: "0xb1", outcomeIndex: 1, outcomeToken: LOW, underlyingToken: HIGH },
        { ...row, id: "0xb2", outcomeIndex: 0, outcomeToken: HIGH, underlyingToken: LOW },
        { ...row, id: "0xb3", outcomeIndex: 1, outcomeToken: HIGH, underlyingToken: LOW },
        { ...row, id: "0xb4", outcomeIndex: 0, outcomeToken: LOW, underlyingToken: HIGH },
      ],
    });

    expect(stats.pools.map(({ id, side }) => [id, side])).toEqual([
      ["0xb1", "UP"],
      ["0xb2", "DOWN"],
      ["0xb3", "UP"],
      ["0xb4", "DOWN"],
    ]);
  });

  it("reads nothing for a session with no pools", async () => {
    const client = {
      multicall: () => {
        throw new Error("no read expected");
      },
    } as unknown as PublicClient;

    await expect(fetchPoolBalances(client, [])).resolves.toEqual({});
  });
});

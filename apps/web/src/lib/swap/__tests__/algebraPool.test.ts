import { encodeFunctionData, type Abi, type Address, type PublicClient } from "viem";
import { describe, expect, it } from "vitest";

import { readPoolLiquidity } from "../algebraPool";
import { sqrtPriceAtTick } from "../tickMath";

const POOL = "0x63AeC253E5dBdcfc634f5e9Dd18daAEB6632C7C7" as Address;

interface Read {
  functionName: string;
  abi: Abi;
  address: Address;
  args?: readonly unknown[];
}

// viem constructs PublicClient around a transport; this fake answers ABI-validated pool reads.
function fakePool(state: {
  tick: number;
  rows: Record<number, bigint>;
  deltas: Record<number, bigint>;
  price?: bigint;
}) {
  const answer = (read: Read): unknown => {
    if (read.address !== POOL) throw new Error(`unexpected pool ${read.address}`);
    encodeFunctionData({ abi: read.abi, functionName: read.functionName, args: read.args });
    const { functionName, args = [] } = read;
    switch (functionName) {
      case "globalState":
        return [state.price ?? sqrtPriceAtTick(state.tick), state.tick, 3000, 0, 0, 0, true];
      case "liquidity":
        return 10n ** 18n;
      case "tickTable":
        return state.rows[args[0] as number] ?? 0n;
      case "ticks": {
        const delta = state.deltas[args[0] as number] ?? 0n;
        return [0n, delta, 0n, 0n, 0n, 0n, 0, delta !== 0n];
      }
      default:
        throw new Error(`unexpected read ${functionName}`);
    }
  };
  return {
    readContract: async (read: Read) => answer(read),
    multicall: async ({ contracts, allowFailure }: { contracts: Read[]; allowFailure: false }) => {
      if (allowFailure !== false) throw new Error("expected atomic pool reads");
      return contracts.map(answer);
    },
  } as unknown as PublicClient;
}

describe("readPoolLiquidity on a Swapr (Algebra v1.9) pool with tick spacing 60", () => {
  it("reads tickTable row tick >> 8, bit tick & 255, with the tick uncompressed", async () => {
    // Swapr pool 0x63Ae…C7C7 on Gnosis, read 2026-10-13: tick 47516, tickSpacing 60,
    // tickTable(187) has bit 128 set and ticks(48000).initialized is true
    const client = fakePool({ tick: 47516, rows: { 187: 1n << 128n }, deltas: { 48000: -4203819159984215271n } });

    const pool = await readPoolLiquidity(client, { address: POOL, outcomeIsToken0: true }, sqrtPriceAtTick(48060));

    expect(pool.ticks).toEqual([{ tick: 48000, liquidityDelta: -4203819159984215271n }]);
  });

  it("reads a negative tick from the row below zero, bit counted from that row's start", async () => {
    // -60 = -1 * 256 + 196
    const client = fakePool({ tick: 100, rows: { [-1]: 1n << 196n }, deltas: { [-60]: 5n } });

    const pool = await readPoolLiquidity(client, { address: POOL, outcomeIsToken0: true }, sqrtPriceAtTick(-120));

    expect(pool.ticks).toEqual([{ tick: -60, liquidityDelta: 5n }]);
  });
});

describe("pool tick scan boundaries", () => {
  it.each([
    [100, 600],
    [600, 100],
  ])("keeps all crossing rows from tick %i toward %i", async (tick, toward) => {
    const client = fakePool({
      tick,
      rows: { 0: 1n << 120n, 1: 1n << 44n, 2: 1n << 88n },
      deltas: { 120: 2n, 300: -3n, 600: 5n },
    });
    const pool = await readPoolLiquidity(client, { address: POOL, outcomeIsToken0: true }, sqrtPriceAtTick(toward));
    expect(pool.ticks).toEqual([
      { tick: 120, liquidityDelta: 2n },
      { tick: 300, liquidityDelta: -3n },
      { tick: 600, liquidityDelta: 5n },
    ]);
  });
  it("does not scan ticks without a target", async () => {
    const client = fakePool({ tick: 0, rows: { 0: 1n }, deltas: { 0: 7n } });
    client.multicall = () => {
      throw new Error("unexpected tick scan");
    };
    const pool = await readPoolLiquidity(client, { address: POOL, outcomeIsToken0: true });
    expect(pool.ticks).toEqual([]);
  });

  it("does not scan ticks when the pool price is uninitialised", async () => {
    const client = fakePool({ tick: 0, rows: { 0: 1n }, deltas: { 0: 7n }, price: 0n });
    client.multicall = () => {
      throw new Error("unexpected tick scan");
    };
    const pool = await readPoolLiquidity(client, { address: POOL, outcomeIsToken0: true }, 2n ** 96n);
    expect(pool.ticks).toEqual([]);
  });
});

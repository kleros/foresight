import type { Address, PublicClient } from "viem";
import { describe, expect, it } from "vitest";

import { readPoolLiquidity } from "../algebraPool";
import { sqrtPriceAtTick } from "../tickMath";

const POOL = "0x63AeC253E5dBdcfc634f5e9Dd18daAEB6632C7C7" as Address;

interface Read {
  functionName: string;
  args?: readonly unknown[];
}

/**
 * A pool answering only the four reads `readPoolLiquidity` makes. Cast to PublicClient because
 * viem builds a client only around a transport; the reads it answers keep the pool ABI's shapes.
 */
function fakePool(state: { tick: number; rows: Record<number, bigint>; deltas: Record<number, bigint> }) {
  const answer = ({ functionName, args = [] }: Read): unknown => {
    switch (functionName) {
      case "globalState":
        return [sqrtPriceAtTick(state.tick), state.tick, 3000, 0, 0, 0, true];
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
    multicall: async ({ contracts }: { contracts: Read[] }) => contracts.map(answer),
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

import { parseAbi, type Address, type PublicClient } from "viem";

import type { InitializedTick, PoolLiquidity } from "@/types/pool";

import { tickAtSqrtPrice } from "./tickMath";

/**
 * Algebra names its sqrt price `price` and keeps the active liquidity separately. Verified
 * against Swapr's pools on Gnosis: both agree with what the indexer records from Swap events.
 * Its tick bitmap is keyed by the uncompressed tick: row `tick >> 8`, bit `tick & 255`.
 */
const ALGEBRA_POOL_ABI = parseAbi([
  "function globalState() view returns (uint160 price, int24 tick, uint16 fee, uint16 timepointIndex, uint8 communityFeeToken0, uint8 communityFeeToken1, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function tickTable(int16) view returns (uint256)",
  "function ticks(int24) view returns (uint128 liquidityTotal, int128 liquidityDelta, uint256 outerFeeGrowth0Token, uint256 outerFeeGrowth1Token, int56 outerTickCumulative, uint160 outerSecondsPerLiquidity, uint32 outerSecondsSpent, bool initialized)",
]);

export interface PoolRef {
  address: Address;
  outcomeIsToken0: boolean;
}

/** The initialised ticks from `fromTick` to `toTick`, both included. */
async function readInitializedTicks(
  client: PublicClient,
  address: Address,
  fromTick: number,
  toTick: number,
): Promise<InitializedTick[]> {
  const rows: number[] = [];
  for (let row = fromTick >> 8; row <= toTick >> 8; row += 1) rows.push(row);

  const words = await client.multicall({
    contracts: rows.map((row) => ({ address, abi: ALGEBRA_POOL_ABI, functionName: "tickTable", args: [row] }) as const),
    allowFailure: false,
    batchSize: 0,
  });

  const initialized: number[] = [];
  for (const [index, word] of words.entries()) {
    if (word === 0n) continue;
    for (let bit = 0; bit < 256; bit += 1) {
      if (((word >> BigInt(bit)) & 1n) === 1n) initialized.push(rows[index]! * 256 + bit);
    }
  }

  const states = await client.multicall({
    contracts: initialized.map(
      (tick) => ({ address, abi: ALGEBRA_POOL_ABI, functionName: "ticks", args: [tick] }) as const,
    ),
    allowFailure: false,
    batchSize: 0,
  });

  return initialized.map((tick, index) => ({ tick, liquidityDelta: states[index]![1] }));
}

/**
 * A pool as it stands now, read from the chain rather than the indexer: the indexer's liquidity
 * comes from Swap events alone, so a pool seeded but never traded reads as empty there. Reads the
 * initialised ticks between the price and `towardSqrtPriceX96`, and none without it.
 */
export async function readPoolLiquidity(
  client: PublicClient,
  ref: PoolRef,
  towardSqrtPriceX96?: bigint,
): Promise<PoolLiquidity> {
  const [state, liquidity] = await Promise.all([
    client.readContract({ address: ref.address, abi: ALGEBRA_POOL_ABI, functionName: "globalState" }),
    client.readContract({ address: ref.address, abi: ALGEBRA_POOL_ABI, functionName: "liquidity" }),
  ]);
  const [sqrtPriceX96, tick, fee] = state;

  let ticks: InitializedTick[] = [];
  if (towardSqrtPriceX96 !== undefined && sqrtPriceX96 > 0n) {
    const toward = tickAtSqrtPrice(towardSqrtPriceX96);
    ticks = await readInitializedTicks(
      client,
      ref.address,
      tick < toward ? tick : toward,
      tick < toward ? toward : tick,
    );
  }

  return { sqrtPriceX96, tick, liquidity, fee: BigInt(fee), ticks, outcomeIsToken0: ref.outcomeIsToken0 };
}

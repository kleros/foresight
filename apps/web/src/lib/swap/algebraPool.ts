import { parseAbi, type Address, type PublicClient } from "viem";

import type { PoolLiquidity } from "@/types/pool";

/**
 * Algebra names its sqrt price `price` and keeps the active liquidity separately. Verified
 * against Swapr's pools on Gnosis: both agree with what the indexer records from Swap events.
 */
const ALGEBRA_POOL_ABI = parseAbi([
  "function globalState() view returns (uint160 price, int24 tick, uint16 fee, uint16 timepointIndex, uint8 communityFeeToken0, uint8 communityFeeToken1, bool unlocked)",
  "function liquidity() view returns (uint128)",
]);

export interface PoolRef {
  address: Address;
  outcomeIsToken0: boolean;
}

/**
 * A pool as it stands now, read from the chain rather than the indexer: the indexer's liquidity
 * comes from Swap events alone, so a pool seeded but never traded reads as empty there.
 */
export async function readPoolLiquidity(client: PublicClient, ref: PoolRef): Promise<PoolLiquidity> {
  const [state, liquidity] = await Promise.all([
    client.readContract({ address: ref.address, abi: ALGEBRA_POOL_ABI, functionName: "globalState" }),
    client.readContract({ address: ref.address, abi: ALGEBRA_POOL_ABI, functionName: "liquidity" }),
  ]);

  return { sqrtPriceX96: state[0], liquidity, outcomeIsToken0: ref.outcomeIsToken0 };
}

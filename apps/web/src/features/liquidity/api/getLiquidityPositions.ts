"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import {
  ContractFunctionExecutionError,
  isAddressEqual,
  parseAbi,
  type Address,
  type PublicClient,
} from "viem";

import { STALE_TIME } from "@/lib/query";
import { sqrtPriceAtTick } from "@/lib/swap/tickMath";
import { publicClient } from "@/lib/web3/public-client";

import { amount0Delta, amount1Delta } from "../flow/math";
import { LIQUIDITY_ALLOW_LIST } from "../oracle/allowlist";
import type { LiquidityPosition, SessionPools } from "../types";
import { liquidityKeyPrefix } from "./getLiquidityPools";

const NFPM_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
]);

/** Calldata bytes per Multicall3 request; a wallet anyone can send NFTs to is read in requests of this size. */
export const POSITION_READ_BATCH_BYTES = 1_024;

/** True when the entry's own call reverted; a failure naming `aggregate3` is a refused request, rethrown to retry. */
function ownCallReverted(entry: { status: "success" | "failure"; error?: unknown }, functionName: string) {
  if (entry.status === "success") return false;
  if (entry.error instanceof ContractFunctionExecutionError && entry.error.functionName === functionName) return true;
  throw entry.error;
}

const pairKey = (a: Address, b: Address) => (BigInt(a) < BigInt(b) ? `${a}|${b}` : `${b}|${a}`).toLowerCase();

/** What burning all of `liquidity` over [tickLower, tickUpper] returns at `sqrtP`, rounded down. */
function withdrawal(sqrtP: bigint, tickLower: number, tickUpper: number, liquidity: bigint) {
  const sqrtA = sqrtPriceAtTick(tickLower);
  const sqrtB = sqrtPriceAtTick(tickUpper);
  if (sqrtP <= sqrtA) return { amount0: amount0Delta(sqrtA, sqrtB, liquidity, false), amount1: 0n };
  if (sqrtP >= sqrtB) return { amount0: 0n, amount1: amount1Delta(sqrtA, sqrtB, liquidity, false) };
  return {
    amount0: amount0Delta(sqrtP, sqrtB, liquidity, false),
    amount1: amount1Delta(sqrtA, sqrtP, liquidity, false),
  };
}

/** The owner's position NFTs in this session's pools that hold liquidity and that `ownerOf` names the owner of. */
export async function fetchLiquidityPositions(
  client: PublicClient,
  { pools, owner }: { pools: SessionPools; owner: Address },
): Promise<LiquidityPosition[]> {
  const list = LIQUIDITY_ALLOW_LIST[pools.session.chainId];
  if (!list) throw new Error(`No liquidity allow list for chain ${pools.session.chainId}.`);
  const manager = { address: list.positionManager, abi: NFPM_ABI } as const;

  const prices = new Map<string, bigint>();
  pools.session.branches.forEach((branch, index) => {
    const { up, down } = pools.branches[index]!;
    if (up.status !== "missing") prices.set(pairKey(branch.upToken, branch.outcome), up.sqrtPriceX96);
    if (down.status !== "missing") prices.set(pairKey(branch.downToken, branch.outcome), down.sqrtPriceX96);
  });

  const balance = await client.readContract({ ...manager, functionName: "balanceOf", args: [owner] });
  if (balance === 0n || prices.size === 0) return [];

  const indexes: bigint[] = [];
  for (let index = 0n; index < balance; index += 1n) indexes.push(index);
  const enumerated = await client.multicall({
    contracts: indexes.map((index) => ({
      ...manager,
      functionName: "tokenOfOwnerByIndex" as const,
      args: [owner, index] as const,
    })),
    batchSize: POSITION_READ_BATCH_BYTES,
  });
  const tokenIds = enumerated.flatMap((each) =>
    ownCallReverted(each, "tokenOfOwnerByIndex") ? [] : [each.result as bigint],
  );
  const reads = await client.multicall({
    contracts: tokenIds.flatMap((tokenId) => [
      { ...manager, functionName: "positions" as const, args: [tokenId] as const },
      { ...manager, functionName: "ownerOf" as const, args: [tokenId] as const },
    ]),
    batchSize: POSITION_READ_BATCH_BYTES,
  });

  return tokenIds.flatMap((tokenId, index) => {
    const [read, held] = [reads[index * 2]!, reads[index * 2 + 1]!];
    const reverted = [ownCallReverted(read, "positions"), ownCallReverted(held, "ownerOf")];
    if (reverted.includes(true)) return [];
    const [position, holder] = [read.result, held.result] as [
      readonly [bigint, Address, Address, Address, number, number, bigint, ...bigint[]],
      Address,
    ];
    const [, , token0, token1, tickLower, tickUpper, liquidity] = position;
    const sqrtP = prices.get(pairKey(token0, token1));
    if (sqrtP === undefined || liquidity === 0n || !isAddressEqual(holder, owner)) return [];
    return [
      {
        tokenId,
        token0,
        token1,
        tickLower,
        tickUpper,
        liquidity,
        ...withdrawal(sqrtP, tickLower, tickUpper, liquidity),
      },
    ];
  });
}

export function useLiquidityPositions(pools: SessionPools | undefined, owner: Address | undefined) {
  return useQuery({
    // keyed on the pools read, so positions refetch when a pool appears or moves; the key hasher cannot take bigint
    queryKey: [
      ...liquidityKeyPrefix,
      "positions",
      pools && JSON.stringify(pools, (_, value) => (typeof value === "bigint" ? value.toString() : value)),
      owner?.toLowerCase(),
    ],
    queryFn: pools && owner ? () => fetchLiquidityPositions(publicClient, { pools, owner }) : skipToken,
    staleTime: STALE_TIME.live,
  });
}

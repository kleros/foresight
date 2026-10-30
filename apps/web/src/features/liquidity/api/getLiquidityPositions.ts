"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import {
  ContractFunctionExecutionError,
  decodeFunctionResult,
  encodeFunctionData,
  isAddressEqual,
  maxUint128,
  parseAbi,
  type Address,
  type PublicClient,
} from "viem";

import { STALE_TIME } from "@/lib/query";
import { sqrtPriceAtTick } from "@/lib/swap/tickMath";
import { publicClient } from "@/lib/web3/public-client";

import { POSITION_MANAGER_ABI } from "../flow/abi";
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

/** Positions whose `collect` one simulated position-manager multicall carries. */
export const COLLECT_READ_BATCH = 20;

/** True when the entry's own call reverted; a failure naming `aggregate3` is a refused request, rethrown to retry. */
function ownCallReverted(entry: { status: "success" | "failure"; error?: unknown }, functionName: string) {
  if (entry.status === "success") return false;
  if (entry.error instanceof ContractFunctionExecutionError && entry.error.functionName === functionName) return true;
  throw entry.error;
}

type PositionRead = {
  address: Address;
  abi: typeof NFPM_ABI;
  functionName: "tokenOfOwnerByIndex" | "positions" | "ownerOf";
  args: readonly unknown[];
};

/**
 * `reads` cut into aggregate3 calls of POSITION_READ_BATCH_BYTES as viem cuts them, each sent once the one before
 * answered: an HTTP transport with batching on sends concurrent calls as one JSON-RPC batch, which a node that caps
 * batches refuses whole.
 */
async function readInTurn(
  client: PublicClient,
  reads: PositionRead[],
): Promise<{ status: "success" | "failure"; result?: unknown; error?: unknown }[]> {
  const chunks: PositionRead[][] = [];
  let size = 0;
  for (const read of reads) {
    const bytes = (encodeFunctionData(read as Parameters<typeof encodeFunctionData>[0]).length - 2) / 2;
    const last = chunks.at(-1);
    if (last && size + bytes <= POSITION_READ_BATCH_BYTES) {
      last.push(read);
      size += bytes;
    } else {
      chunks.push([read]);
      size = bytes;
    }
  }
  const results: { status: "success" | "failure"; result?: unknown; error?: unknown }[] = [];
  for (const contracts of chunks) {
    results.push(...(await client.multicall({ contracts, batchSize: POSITION_READ_BATCH_BYTES })));
  }
  return results;
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

/**
 * What `collect` pays each position now: its tokensOwed and the fees earned since last poked. Simulated from the
 * owner through the position manager's own multicall, since `collect` refuses a caller not holding the token.
 */
async function collectable(client: PublicClient, manager: Address, owner: Address, tokenIds: bigint[]) {
  const owed: { amount0: bigint; amount1: bigint }[] = [];
  for (let start = 0; start < tokenIds.length; start += COLLECT_READ_BATCH) {
    const calls = tokenIds.slice(start, start + COLLECT_READ_BATCH).map((tokenId) =>
      encodeFunctionData({
        abi: POSITION_MANAGER_ABI,
        functionName: "collect",
        args: [{ tokenId, recipient: owner, amount0Max: maxUint128, amount1Max: maxUint128 }],
      }),
    );
    const { result } = await client.simulateContract({
      address: manager,
      abi: POSITION_MANAGER_ABI,
      functionName: "multicall",
      args: [calls],
      account: owner,
    });
    for (const data of result) {
      const [amount0, amount1] = decodeFunctionResult({ abi: POSITION_MANAGER_ABI, functionName: "collect", data });
      owed.push({ amount0, amount1 });
    }
  }
  return owed;
}

/**
 * The owner's position NFTs in this session's pools that hold liquidity and that `ownerOf` names the owner of, each
 * with what a Remove of it pays: its liquidity's principal at the pool's price, plus what `collect` pays.
 */
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
  const enumerated = await readInTurn(
    client,
    indexes.map((index) => ({ ...manager, functionName: "tokenOfOwnerByIndex", args: [owner, index] })),
  );
  const tokenIds = enumerated.flatMap((each) =>
    ownCallReverted(each, "tokenOfOwnerByIndex") ? [] : [each.result as bigint],
  );
  const reads = await readInTurn(
    client,
    tokenIds.flatMap((tokenId): PositionRead[] => [
      { ...manager, functionName: "positions", args: [tokenId] },
      { ...manager, functionName: "ownerOf", args: [tokenId] },
    ]),
  );

  const listed = tokenIds.flatMap((tokenId, index): LiquidityPosition[] => {
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
  const owed = await collectable(
    client,
    list.positionManager,
    owner,
    listed.map((position) => position.tokenId),
  );
  return listed.map((position, index) => ({
    ...position,
    amount0: position.amount0 + owed[index]!.amount0,
    amount1: position.amount1 + owed[index]!.amount1,
  }));
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

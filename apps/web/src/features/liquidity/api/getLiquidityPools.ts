"use client";

import { gnosis } from "@foresight/contracts";
import { skipToken, useQuery } from "@tanstack/react-query";
import { isAddressEqual, parseAbi, zeroAddress, type Address, type PublicClient } from "viem";

import { STALE_TIME } from "@/lib/query";
import { publicClient } from "@/lib/web3/public-client";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { LIQUIDITY_ALLOW_LIST } from "../oracle/allowlist";
import type { LiquiditySession, PoolState, SessionPools } from "../types";

const MARKET_ABI = parseAbi([
  "function wrappedOutcome(uint256 index) view returns (address wrapped1155, bytes data)",
  "function numOutcomes() view returns (uint256)",
  "function parentWrappedOutcome() view returns (address wrapped1155, bytes data)",
]);
const FACTORY_ABI = parseAbi(["function poolByPair(address tokenA, address tokenB) view returns (address)"]);
const POOL_ABI = parseAbi([
  "function globalState() view returns (uint160 price, int24 tick, uint16 fee, uint16 timepointIndex, uint8 communityFeeToken0, uint8 communityFeeToken1, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function tickSpacing() view returns (int24)",
]);

const S_DAI: Record<number, Address> = gnosis.savingsXDaiAddress;

export interface SessionMarkets {
  parentMarket: Address;
  /** `childMarkets[i]` is the child market of parent outcome `i`. */
  childMarkets: readonly Address[];
}

/** Every liquidity read's query key starts with this; invalidate it after a run. */
export const liquidityKeyPrefix = ["liquidity"] as const;

async function readSession(
  client: PublicClient,
  chainId: number,
  { parentMarket, childMarkets }: SessionMarkets,
): Promise<LiquiditySession> {
  const collateral = S_DAI[chainId];
  if (!collateral) throw new Error(`No sDAI on chain ${chainId}.`);
  const count = childMarkets.length;
  const parent = { address: parentMarket, abi: MARKET_ABI } as const;
  const contracts = [
    { ...parent, functionName: "numOutcomes" as const },
    ...Array.from({ length: count + 1 }, (_, index) => ({
      ...parent,
      functionName: "wrappedOutcome" as const,
      args: [BigInt(index)] as const,
    })),
    ...childMarkets.flatMap((address) => [
      { address, abi: MARKET_ABI, functionName: "parentWrappedOutcome" as const },
      ...[0n, 1n, 2n].map((index) => ({
        address,
        abi: MARKET_ABI,
        functionName: "wrappedOutcome" as const,
        args: [index] as const,
      })),
    ]),
  ];
  const results = await client.multicall({ contracts, allowFailure: false, batchSize: 0 });
  const [outcomeCount, ...rest] = results as [bigint, ...(readonly [Address, `0x${string}`])[]];
  if (outcomeCount !== BigInt(count)) throw new Error("The session's child markets do not match its parent market.");
  const token = (index: number) => rest[index]![0];
  const branches = childMarkets.map((childMarket, index) => {
    const at = count + 1 + index * 4;
    const outcome = token(index);
    if (!isAddressEqual(token(at), outcome)) throw new Error("A child market does not belong to this session.");
    return { childMarket, outcome, downToken: token(at + 1), upToken: token(at + 2), invalidToken: token(at + 3) };
  });
  return { chainId, parentMarket, collateral, parentInvalid: token(count), branches };
}

const poolReads = (address: Address) => [
  { address, abi: POOL_ABI, functionName: "globalState" as const },
  { address, abi: POOL_ABI, functionName: "liquidity" as const },
  { address, abi: POOL_ABI, functionName: "tickSpacing" as const },
];

type PoolReads = [readonly [bigint, ...unknown[]], bigint, number];

function toPoolState([[sqrtPriceX96], liquidity, tickSpacing]: PoolReads): PoolState {
  // a created pool with no price yet is initialized by createAndInitializePoolIfNecessary, as a missing one is
  if (sqrtPriceX96 === 0n) return { status: "missing" };
  if (liquidity === 0n) return { status: "empty", sqrtPriceX96, tickSpacing };
  return { status: "live", sqrtPriceX96, liquidity, tickSpacing };
}

/** The pair's pool as it stands, tokens in either order, found through the allow list's factory (L5). */
export async function fetchPoolState(
  client: PublicClient,
  chainId: number,
  tokenA: Address,
  tokenB: Address,
): Promise<PoolState> {
  const list = LIQUIDITY_ALLOW_LIST[chainId];
  if (!list) throw new Error(`No liquidity allow list for chain ${chainId}.`);
  const address = await client.readContract({
    address: list.algebraFactory,
    abi: FACTORY_ABI,
    functionName: "poolByPair",
    args: [tokenA, tokenB],
  });
  if (isAddressEqual(address, zeroAddress)) return { status: "missing" };
  const reads = await client.multicall({ contracts: poolReads(address), allowFailure: false, batchSize: 0 });
  return toPoolState(reads as unknown as PoolReads);
}

/** Each branch's UP and DOWN pool, from the session's own markets and `poolByPair` on the allow list's factory (L5). */
export async function fetchLiquidityPools(
  client: PublicClient,
  markets: SessionMarkets & { chainId: number },
): Promise<SessionPools> {
  const list = LIQUIDITY_ALLOW_LIST[markets.chainId];
  if (!list) throw new Error(`No liquidity allow list for chain ${markets.chainId}.`);
  const session = await readSession(client, markets.chainId, markets);

  const pairs = session.branches.flatMap((branch) => [
    [branch.upToken, branch.outcome] as const,
    [branch.downToken, branch.outcome] as const,
  ]);
  const addresses = await client.multicall({
    contracts: pairs.map((args) => ({
      address: list.algebraFactory,
      abi: FACTORY_ABI,
      functionName: "poolByPair" as const,
      args,
    })),
    allowFailure: false,
    batchSize: 0,
  });

  const existing = addresses.filter((address) => !isAddressEqual(address, zeroAddress));
  const reads = existing.length
    ? await client.multicall({
        contracts: existing.flatMap(poolReads),
        allowFailure: false,
        batchSize: 0,
      })
    : [];

  const states = new Map<Address, PoolState>(
    existing.map((address, index) => [address, toPoolState(reads.slice(index * 3, index * 3 + 3) as PoolReads)]),
  );
  const stateOf = (address: Address): PoolState => states.get(address) ?? { status: "missing" };

  return {
    session,
    branches: session.branches.map((_, index) => ({
      up: stateOf(addresses[index * 2]!),
      down: stateOf(addresses[index * 2 + 1]!),
    })),
  };
}

export const sessionHasLiquidity = (pools: SessionPools) =>
  pools.branches.some(({ up, down }) => up.status === "live" || down.status === "live");

export function useLiquidityPools(markets: SessionMarkets | undefined) {
  return useQuery({
    queryKey: [
      ...liquidityKeyPrefix,
      "pools",
      DEFAULT_CHAIN_ID,
      markets?.parentMarket.toLowerCase(),
      markets?.childMarkets.map((each) => each.toLowerCase()),
    ],
    queryFn: markets ? () => fetchLiquidityPools(publicClient, { ...markets, chainId: DEFAULT_CHAIN_ID }) : skipToken,
    staleTime: STALE_TIME.live,
  });
}

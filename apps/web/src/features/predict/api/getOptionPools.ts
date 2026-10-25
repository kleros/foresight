"use client";

import { isAddressEqual, parseAbi, zeroAddress, type Address, type PublicClient } from "viem";

import type { PoolRef } from "@/lib/swap/algebraPool";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { swaprFactoryAddress } from "@/config/contracts";

import type { PredictOption } from "../flow/types";

const FACTORY_ABI = parseAbi(["function poolByPair(address tokenA, address tokenB) view returns (address)"]);
const POOL_ABI = parseAbi(["function token0() view returns (address)", "function token1() view returns (address)"]);

export type OptionPoolRefs = { up?: PoolRef; down?: PoolRef };
export type PoolRefsByMarket = Record<string, OptionPoolRefs>;

const references = new WeakMap<PublicClient, Map<string, Promise<PoolRef | undefined>>>();

async function poolRef(
  client: PublicClient,
  factory: Address,
  outcome: Address,
  underlying: Address,
): Promise<PoolRef | undefined> {
  let cache = references.get(client);
  if (!cache) references.set(client, (cache = new Map()));
  const key = `${factory}:${outcome}:${underlying}`.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;
  const reading = (async () => {
    const address = await client.readContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: "poolByPair",
      args: [outcome, underlying],
    });
    if (isAddressEqual(address, zeroAddress)) return undefined;
    const [token0, token1] = await Promise.all([
      client.readContract({ address, abi: POOL_ABI, functionName: "token0" }),
      client.readContract({ address, abi: POOL_ABI, functionName: "token1" }),
    ]);
    const outcomeIsToken0 = isAddressEqual(outcome, token0);
    if (
      !isAddressEqual(outcome, outcomeIsToken0 ? token0 : token1) ||
      !isAddressEqual(underlying, outcomeIsToken0 ? token1 : token0)
    ) {
      throw new Error("The trading pool does not match this option's tokens.");
    }
    return { address, outcomeIsToken0 };
  })();
  cache.set(key, reading);
  try {
    const ref = await reading;
    // A missing pool can be created later; an existing pool's identity and tokens cannot change.
    if (!ref) cache.delete(key);
    return ref;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

/** Canonical references shared by preview and execution, cached per client and token pair. */
export async function fetchSessionPools(
  client: PublicClient,
  options: readonly Pick<PredictOption, "childMarket" | "upToken" | "downToken" | "underlying">[],
): Promise<PoolRefsByMarket> {
  const factory = swaprFactoryAddress(client.chain?.id ?? DEFAULT_CHAIN_ID);
  if (!factory) throw new Error("This network has no trading pool factory.");
  return Object.fromEntries(
    await Promise.all(
      options.map(async (option) => {
        const [up, down] = await Promise.all([
          poolRef(client, factory, option.upToken, option.underlying),
          poolRef(client, factory, option.downToken, option.underlying),
        ]);
        return [option.childMarket.toLowerCase(), { up, down }];
      }),
    ),
  );
}

/** An option without a pool has no tradeable side. */
export function optionPoolRefs(byMarket: PoolRefsByMarket, childMarket: string): OptionPoolRefs {
  return byMarket[childMarket.toLowerCase()] ?? {};
}

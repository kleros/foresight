"use client";

import { erc20Abi, type Address, type PublicClient } from "viem";

import { readPoolLiquidity, type PoolRef } from "@/lib/swap/algebraPool";
import { fetchTokenBalances } from "@/lib/trade-executor/balances";

import type { PoolLiquidity } from "@/types/pool";

import { fetchSessionPools, optionPoolRefs } from "../api/getOptionPools";
import type { OptionChainState, PredictReader } from "../flow/types";

/** A side with no pool, which `volumeUntilPrice` sizes to nothing. */
const UNPRICED: PoolLiquidity = { sqrtPriceX96: 0n, liquidity: 0n, outcomeIsToken0: true };

/**
 * What the plan reads before it builds. Everything that decides an amount comes from the chain:
 * the indexer only says where the pools are.
 */
export function createPredictReader(args: {
  client: PublicClient;
  sessionId: string;
  collateral: Address;
}): PredictReader {
  const poolState = async (ref: PoolRef | undefined): Promise<PoolLiquidity> =>
    ref === undefined ? UNPRICED : readPoolLiquidity(args.client, ref);

  return {
    async isExecutorDeployed(executor) {
      const code = await args.client.getCode({ address: executor });
      return code !== undefined && code !== "0x";
    },

    collateralBalance(executor) {
      return args.client.readContract({
        address: args.collateral,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [executor],
      });
    },

    async optionStates({ options, executor }) {
      const [refs, balances] = await Promise.all([
        fetchSessionPools(args.sessionId),
        fetchTokenBalances(args.client, {
          holder: executor,
          tokens: options.flatMap((option) => [
            option.upToken,
            option.downToken,
            option.invalidToken,
            option.underlying,
          ]),
        }),
      ]);

      return Promise.all(
        options.map(async (option, index): Promise<OptionChainState> => {
          const sides = optionPoolRefs(refs, option.childMarket);
          const [up, down] = await Promise.all([poolState(sides.up), poolState(sides.down)]);
          const at = index * 4;

          return {
            pools: { up, down },
            held: { up: balances[at] ?? 0n, down: balances[at + 1] ?? 0n, invalid: balances[at + 2] ?? 0n },
            underlying: balances[at + 3] ?? 0n,
          };
        }),
      );
    },
  };
}

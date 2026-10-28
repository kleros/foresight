"use client";

import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { isAddressEqual, type Address } from "viem";
import { useAccount } from "wagmi";

import { STALE_TIME } from "@/lib/query";
import { publicClient } from "@/lib/web3/public-client";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { useLiquidityBalances, type LiquidityBalances } from "../api/getLiquidityBalances";
import { liquidityKeyPrefix, sessionHasLiquidity, useLiquidityPools } from "../api/getLiquidityPools";
import { useLiquidityPositions } from "../api/getLiquidityPositions";
import { planMerge } from "../flow/plan";
import { createLiquidityReader } from "../run/reader";
import type { LiquidityRequest, LiquiditySession, SessionPools } from "../types";
import { useLiquidityRun } from "./useLiquidityRun";

export interface LiquidityBranchName {
  /** The child market of parent outcome `outcomeIndex`. */
  market: Address;
  outcomeIndex: number;
  name: string;
}

export interface TokenAmount {
  label: string;
  amount: bigint;
}

export interface ShownPosition {
  key: string;
  pool: string;
  /** What withdrawing all of it returns now. */
  returns: TokenAmount[];
  request: LiquidityRequest;
}

export interface ShownMerge {
  /** The outcome tokens each branch's merge returns, for the branches that merge. */
  branches: TokenAmount[];
  /** The sDAI the parent merge returns, where it merges any. */
  parentMerge?: bigint;
  request: LiquidityRequest;
}

/** Every token of the session, named for the screen. */
export function tokenLabels(session: LiquiditySession, names: string[]) {
  const labels = new Map<string, string>([
    [session.collateral.toLowerCase(), "sDAI"],
    [session.parentInvalid.toLowerCase(), "INVALID"],
  ]);
  session.branches.forEach((branch, index) => {
    const name = names[index] ?? `Option ${index + 1}`;
    labels.set(branch.outcome.toLowerCase(), name);
    labels.set(branch.upToken.toLowerCase(), `${name} UP`);
    labels.set(branch.downToken.toLowerCase(), `${name} DOWN`);
    labels.set(branch.invalidToken.toLowerCase(), `${name} INVALID`);
  });
  return (token: Address) => labels.get(token.toLowerCase()) ?? token;
}

/** The pool of the session over this pair, with its branch and side. */
function poolOf(pools: SessionPools, tokenA: Address, tokenB: Address) {
  for (const [index, branch] of pools.session.branches.entries()) {
    for (const side of ["up", "down"] as const) {
      const child = side === "up" ? branch.upToken : branch.downToken;
      const pair = [child, branch.outcome];
      if (pair.some((t) => isAddressEqual(t, tokenA)) && pair.some((t) => isAddressEqual(t, tokenB))) {
        return { index, side, state: pools.branches[index]![side] };
      }
    }
  }
  return undefined;
}

function shownMerge(
  session: LiquiditySession,
  owner: Address,
  balances: LiquidityBalances,
  names: string[],
): ShownMerge | undefined {
  const input = { session, owner, balances: { branches: balances.branches, parentInvalid: balances.parentInvalid } };
  const plan = planMerge(input);
  if (plan.txs.length === 0) return undefined;
  return {
    branches: plan.branches.flatMap(({ merge }, index) =>
      merge > 0n ? [{ label: names[index] ?? "", amount: merge }] : [],
    ),
    ...(plan.parentMerge > 0n ? { parentMerge: plan.parentMerge } : {}),
    request: { kind: "merge", input },
  };
}

/** The chain's latest block time, which a reviewed request carries. */
export function useChainTime() {
  return useQuery({
    queryKey: [...liquidityKeyPrefix, "chainTime", DEFAULT_CHAIN_ID],
    queryFn: () => createLiquidityReader(publicClient, DEFAULT_CHAIN_ID).chainTime(),
    staleTime: STALE_TIME.live,
  });
}

/** A session's liquidity as the market page shows it: its pools, the wallet's positions and merge, and the run. */
export function useSessionLiquidity({
  parentMarket,
  branches,
  closesAt,
  isReady,
}: {
  parentMarket: Address;
  branches: LiquidityBranchName[];
  closesAt: Date | null;
  /** Every child market exists, so the pools can be read. */
  isReady: boolean;
}) {
  const { address: owner } = useAccount();
  const ordered = [...branches].sort((a, b) => a.outcomeIndex - b.outcomeIndex);
  const namesKey = ordered.map((branch) => branch.name).join("\n");
  const names = useMemo(() => (namesKey ? namesKey.split("\n") : []), [namesKey]);
  const childMarkets = ordered.map((branch) => branch.market);
  const pools = useLiquidityPools(isReady ? { parentMarket, childMarkets } : undefined);
  const positions = useLiquidityPositions(pools.data, owner);
  const balances = useLiquidityBalances(pools.data?.session, owner);
  const chainTime = useChainTime();
  const run = useLiquidityRun(parentMarket, closesAt);

  const shown = useMemo(() => {
    const data = pools.data;
    if (!data || !owner) return { positions: [], merge: undefined };
    const label = tokenLabels(data.session, names);
    const time = chainTime.data;
    const shownPositions =
      time === undefined
        ? []
        : (positions.data ?? []).flatMap((position): ShownPosition[] => {
            const pool = poolOf(data, position.token0, position.token1);
            if (!pool || pool.state.status !== "live") return [];
            return [
              {
                key: position.tokenId.toString(),
                pool: `${names[pool.index] ?? ""} ${pool.side === "up" ? "UP" : "DOWN"} pool`,
                returns: [
                  { label: label(position.token0), amount: position.amount0 },
                  { label: label(position.token1), amount: position.amount1 },
                ],
                request: {
                  kind: "remove",
                  session: data.session,
                  input: {
                    chainId: data.session.chainId,
                    owner,
                    chainTime: time,
                    sqrtPriceX96: pool.state.sqrtPriceX96,
                    position: {
                      tokenId: position.tokenId,
                      token0: position.token0,
                      token1: position.token1,
                      tickLower: position.tickLower,
                      tickUpper: position.tickUpper,
                      liquidity: position.liquidity,
                    },
                  },
                },
              },
            ];
          });
    return {
      positions: shownPositions,
      merge: balances.data && shownMerge(data.session, owner, balances.data, names),
    };
  }, [pools.data, positions.data, balances.data, chainTime.data, owner, names]);

  return {
    names,
    pools,
    /** Undefined until the pools are read. */
    hasLiquidity: pools.data ? sessionHasLiquidity(pools.data) : undefined,
    balances: balances.data,
    chainTime: chainTime.data,
    owner,
    positions: shown.positions,
    merge: shown.merge,
    run,
  };
}

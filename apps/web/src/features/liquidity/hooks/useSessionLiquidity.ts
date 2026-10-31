"use client";

import { useMemo } from "react";

import { useQuery, type QueryKey } from "@tanstack/react-query";
import { isAddressEqual, type Address } from "viem";
import { useAccount } from "wagmi";

import { STALE_TIME } from "@/lib/query";
import { publicClient } from "@/lib/web3/public-client";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { useLiquidityBalances, type LiquidityBalances } from "../api/getLiquidityBalances";
import { liquidityKeyPrefix, sessionHasLiquidity, useLiquidityPools } from "../api/getLiquidityPools";
import { useLiquidityPositions } from "../api/getLiquidityPositions";
import { planMerge, planRemove } from "../flow/plan";
import { createLiquidityReader } from "../run/reader";
import type {
  MergeInput,
  LiquidityPosition,
  LiquidityRequest,
  LiquiditySession,
  RemovedPosition,
  RemoveInput,
  SessionPools,
} from "../types";
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

/** One pool's positions, or one position a remove cannot plan with the rest of its pool. */
export interface ShownPosition {
  key: string;
  pool: string;
  /** The position NFTs the row withdraws. */
  count: number;
  /** What withdrawing all of them returns now. */
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
  return mergeShownOf(
    { session, owner, balances: { branches: balances.branches, parentInvalid: balances.parentInvalid } },
    names,
  );
}

/** What merging `input` returns, as Your positions shows it; a held merge run shows its own stored input. */
export function mergeShownOf(input: MergeInput, names: string[]): ShownMerge | undefined {
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

/** Whether a remove can plan `position` alone: in range and large enough to hold to non-zero minimums. */
function withdrawable(input: Omit<RemoveInput, "positions">, position: RemovedPosition) {
  try {
    planRemove({ ...input, positions: [position] });
    return true;
  } catch {
    return false;
  }
}

/**
 * The wallet's positions as the popup lists them: one row per pool, its Remove withdrawing all of them in one
 * multicall. A position the remove cannot plan gets a row of its own, so it never blocks the rest of its pool.
 */
export function shownPools({
  pools,
  positions,
  owner,
  chainTime,
  names,
}: {
  pools: SessionPools;
  positions: LiquidityPosition[];
  owner: Address;
  chainTime: bigint;
  names: string[];
}): ShownPosition[] {
  const label = tokenLabels(pools.session, names);
  const rows = new Map<string, { pool: string; input: Omit<RemoveInput, "positions">; held: LiquidityPosition[] }>();
  for (const position of positions) {
    const pool = poolOf(pools, position.token0, position.token1);
    // a pool reads as empty while every position in it is out of range
    if (!pool || pool.state.status === "missing") continue;
    const input = { chainId: pools.session.chainId, owner, chainTime, sqrtPriceX96: pool.state.sqrtPriceX96 };
    const key = withdrawable(input, position) ? `${pool.index}:${pool.side}` : position.tokenId.toString();
    const row = rows.get(key) ?? {
      pool: `${names[pool.index] ?? ""} ${pool.side === "up" ? "UP" : "DOWN"} pool`,
      input,
      held: [],
    };
    row.held.push(position);
    rows.set(key, row);
  }
  return [...rows].map(([key, { pool, input, held }]) => {
    const [first] = held as [LiquidityPosition];
    const sum = (pick: (each: LiquidityPosition) => bigint) => held.reduce((total, each) => total + pick(each), 0n);
    return {
      key,
      pool,
      count: held.length,
      returns: [
        { label: label(first.token0), amount: sum((each) => each.amount0) },
        { label: label(first.token1), amount: sum((each) => each.amount1) },
      ],
      request: {
        kind: "remove",
        session: pools.session,
        input: {
          ...input,
          positions: held.map(({ tokenId, token0, token1, tickLower, tickUpper, liquidity }) => ({
            tokenId,
            token0,
            token1,
            tickLower,
            tickUpper,
            liquidity,
          })),
        },
      },
    };
  });
}

/** A session's liquidity as the market page shows it: its pools, the wallet's positions and merge, and the run. */
export function useSessionLiquidity({
  parentMarket,
  branches,
  closesAt,
  isReady,
  alsoReread,
}: {
  parentMarket: Address;
  branches: LiquidityBranchName[];
  closesAt: Date | null;
  /** Every child market exists, so the pools can be read. */
  isReady: boolean;
  /** A query of the page's that a landed run changes. */
  alsoReread?: QueryKey;
}) {
  const { address: owner } = useAccount();
  const ordered = [...branches].sort((a, b) => a.outcomeIndex - b.outcomeIndex);
  const namesKey = ordered.map((branch) => branch.name).join("\n");
  const names = useMemo(() => (namesKey ? namesKey.split("\n") : []), [namesKey]);
  const childMarkets = ordered.map((branch) => branch.market);
  // past the resolution date the session trades only while a pool holds liquidity, which any wallet can withdraw
  const pastResolution = closesAt !== null && closesAt.getTime() <= Date.now();
  const pools = useLiquidityPools(isReady ? { parentMarket, childMarkets } : undefined, { poll: pastResolution });
  const positions = useLiquidityPositions(pools.data, owner);
  const balances = useLiquidityBalances(pools.data?.session, owner);
  const chainTime = useChainTime();
  const run = useLiquidityRun(parentMarket, closesAt, alsoReread);

  const shown = useMemo(() => {
    const data = pools.data;
    if (!data || !owner) return { positions: [], merge: undefined };
    const time = chainTime.data;
    const shownPositions =
      time === undefined
        ? []
        : shownPools({ pools: data, positions: positions.data ?? [], owner, chainTime: time, names });
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
    /** The wallet's positions could not be read, so none are listed; never read as holding none. */
    positionsUnread: Boolean(owner) && positions.isError && positions.data === undefined,
    rereadPositions: () => void positions.refetch(),
    merge: shown.merge,
    run,
  };
}

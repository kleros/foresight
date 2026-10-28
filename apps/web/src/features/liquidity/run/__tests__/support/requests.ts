import type { FlowTx } from "@foresight/tx-orchestrator";
import type { Address } from "viem";

import type { LiquidityRequestLike } from "./world";
import {
  CHAIN_TIME,
  branch,
  fullRange,
  owner,
  session,
  txsOf,
  userSqrtPrice,
} from "../../../flow/__tests__/support/session";
import { planMerge, planRemove, planSeed } from "../../../flow/plan";
import type { MergeInput, PoolState, RemoveInput, SeedInput } from "../../../types";

export const WAD = 10n ** 18n;
/** Deep enough that every mint holds to non-zero minimums. */
export const DEPTH = 1_000n * WAD;

/** One branch; its UP token sorts below the parent outcome (the pool's token0), its DOWN token above. */
export const TOKENS = branch(1);
export const SESSION = session([TOKENS]);

export const live = (bps: bigint, childIsToken0: boolean): PoolState => ({
  status: "live",
  sqrtPriceX96: userSqrtPrice(bps, childIsToken0),
  liquidity: 10n ** 21n,
  tickSpacing: 60,
});
export const empty = (bps: bigint, childIsToken0: boolean): PoolState => ({
  status: "empty",
  sqrtPriceX96: userSqrtPrice(bps, childIsToken0),
  tickSpacing: 60,
});

export function seedInput(
  opts: { owner?: Address; pools?: { up: PoolState; down: PoolState }; chainTime?: bigint } = {},
): SeedInput {
  return {
    session: SESSION,
    owner: opts.owner ?? owner,
    total: DEPTH,
    collateral: "sDAI",
    chainTime: opts.chainTime ?? CHAIN_TIME,
    branches: [
      {
        depth: DEPTH,
        upPriceBps: 5_000n,
        pools: opts.pools ?? { up: { status: "missing" }, down: { status: "missing" } },
      },
    ],
  };
}

export const seedRequest = (opts: Parameters<typeof seedInput>[0] = {}): LiquidityRequestLike => ({
  kind: "seed",
  input: seedInput(opts),
});

/** The transactions planSeed builds for `request`: what the sequential path sends, in order. */
export const seedTxs = (input: SeedInput): FlowTx[] => txsOf(planSeed(input).steps);

export const TOKEN_ID = 77n;
/** The UP pool's price at 50%, as `live(5_000n, true)` holds it: the UP token is token0. */
export const REMOVE_PRICE = userSqrtPrice(5_000n, true);

export function removeInput(opts: { owner?: Address; sqrtPriceX96?: bigint; chainTime?: bigint } = {}): RemoveInput {
  const { tickLower, tickUpper } = fullRange(60);
  return {
    chainId: 100,
    owner: opts.owner ?? owner,
    chainTime: opts.chainTime ?? CHAIN_TIME,
    sqrtPriceX96: opts.sqrtPriceX96 ?? REMOVE_PRICE,
    position: {
      tokenId: TOKEN_ID,
      token0: TOKENS.upToken,
      token1: TOKENS.outcome,
      tickLower,
      tickUpper,
      liquidity: 10n ** 21n,
    },
  };
}

export const removeRequest = (opts: Parameters<typeof removeInput>[0] = {}): LiquidityRequestLike => ({
  kind: "remove",
  session: SESSION,
  input: removeInput(opts),
});

export const removeTx = (input: RemoveInput): FlowTx => planRemove(input).tx;

/** Five complete sets at the branch, merged to the outcome and then, with the parent INVALID, to sDAI. */
export function mergeInput(opts: { owner?: Address } = {}): MergeInput {
  return {
    session: SESSION,
    owner: opts.owner ?? owner,
    balances: {
      branches: [{ outcome: 0n, up: 5n * WAD, down: 5n * WAD, invalid: 5n * WAD }],
      parentInvalid: 5n * WAD,
    },
  };
}

export const mergeRequest = (opts: Parameters<typeof mergeInput>[0] = {}): LiquidityRequestLike => ({
  kind: "merge",
  input: mergeInput(opts),
});

export const mergeTxs = (input: MergeInput): FlowTx[] => planMerge(input).txs;

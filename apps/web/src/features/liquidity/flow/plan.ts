import type { FlowTx } from "@foresight/tx-orchestrator";
import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";

import { ALGEBRA_ROUTER_ABI } from "@/lib/swap/algebraRouter";
import { sqrtPriceAtTick } from "@/lib/swap/tickMath";

import { gnosisRouterAbi } from "@/config/contracts";

import { POSITION_MANAGER_ABI } from "./abi";
import {
  BPS,
  amount0Delta,
  amount1Delta,
  fullRange,
  liquidityForAmount0,
  liquidityForAmount1,
  mintAt,
  movedSqrtPrice,
  sqrtPriceForBps,
} from "./math";
import { LIQUIDITY_ALLOW_LIST, type LiquidityAllowList } from "../oracle/allowlist";
import {
  LIQUIDITY_DEADLINE_SECONDS,
  LIQUIDITY_SLIPPAGE_BPS,
  MAX_SEED_PRICE_BPS,
  MIN_SEED_PRICE_BPS,
  MINT_RATE_MARGIN_BPS,
  NEW_POOL_TICK_SPACING,
  REALIGN_DUST_WEI,
  SEED_PRICE_TOLERANCE_TICKS,
} from "../oracle/tolerances";
import type {
  BranchPlan,
  Leftover,
  LiquidityStep,
  MergeInput,
  MergePlan,
  PoolPlan,
  PoolState,
  RemoveInput,
  RemovePlan,
  SeedInput,
  SeedPlan,
} from "../types";

const MAX_UINT128 = 2n ** 128n - 1n;
const SLIPPAGE = BigInt(LIQUIDITY_SLIPPAGE_BPS);

function listFor(chainId: number): LiquidityAllowList {
  const list = LIQUIDITY_ALLOW_LIST[chainId];
  if (!list) throw new Error(`No liquidity allow-list for chain ${chainId}.`);
  return list;
}

const lessSlippage = (amount: bigint) => (amount * (BPS - SLIPPAGE)) / BPS;

function held(amount0Min: bigint, amount1Min: bigint) {
  if (amount0Min <= 0n || amount1Min <= 0n) throw new Error("Too small to hold to non-zero minimums.");
  return { amount0Min, amount1Min };
}

/** What a mint of these amounts still pulls once the price moves SEED_PRICE_TOLERANCE_TICKS against each token. */
const tickHeld = (sqrtP: bigint, sqrtA: bigint, sqrtB: bigint, amount0: bigint, amount1: bigint) =>
  held(
    mintAt(movedSqrtPrice(sqrtP, SEED_PRICE_TOLERANCE_TICKS), sqrtA, sqrtB, amount0, amount1).amount0,
    mintAt(movedSqrtPrice(sqrtP, -SEED_PRICE_TOLERANCE_TICKS), sqrtA, sqrtB, amount0, amount1).amount1,
  );

const approveTx = (token: Address, spender: Address, amount: bigint): FlowTx => ({
  to: token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
});

/** One exact approval per token, summing what the next call pulls of it through `spender`. */
function approvals(id: string, spender: Address, pulls: [Address, bigint][]): LiquidityStep[] {
  const sums = new Map<string, { token: Address; amount: bigint }>();
  for (const [token, amount] of pulls) {
    const key = token.toLowerCase();
    sums.set(key, { token, amount: (sums.get(key)?.amount ?? 0n) + amount });
  }
  return [...sums.entries()].map(([key, { token, amount }]) => ({
    id: `${id}:approve:${key}`,
    tx: approveTx(token, spender, amount),
  }));
}

const multicallTx = (list: LiquidityAllowList, calls: Hex[]): FlowTx => ({
  to: list.positionManager,
  data: encodeFunctionData({ abi: POSITION_MANAGER_ABI, functionName: "multicall", args: [calls] }),
});

type MintPlan = Pick<
  PoolPlan,
  "token0" | "token1" | "tickLower" | "tickUpper" | "amount0" | "amount1" | "amount0Min" | "amount1Min"
>;

const mintCall = (pool: MintPlan, recipient: Address, deadline: bigint): Hex =>
  encodeFunctionData({
    abi: POSITION_MANAGER_ABI,
    functionName: "mint",
    args: [
      {
        token0: pool.token0,
        token1: pool.token1,
        tickLower: pool.tickLower,
        tickUpper: pool.tickUpper,
        amount0Desired: pool.amount0,
        amount1Desired: pool.amount1,
        amount0Min: pool.amount0Min,
        amount1Min: pool.amount1Min,
        recipient,
        deadline,
      },
    ],
  });

const routerTx = (
  list: LiquidityAllowList,
  functionName: "splitPosition" | "mergePositions",
  collateral: Address,
  market: Address,
  amount: bigint,
): FlowTx => ({
  to: list.gnosisRouter,
  data: encodeFunctionData({ abi: gnosisRouterAbi, functionName, args: [collateral, market, amount] }),
});

/** A pool of the run: which way round its tokens sit and the price and range its seed mint meets. */
function resolvePool(outcome: Address, child: Address, bps: bigint, state: PoolState) {
  const childIsToken0 = BigInt(child) < BigInt(outcome);
  const [token0, token1] = childIsToken0 ? [child, outcome] : [outcome, child];
  const target = sqrtPriceForBps(bps, childIsToken0);
  const current = state.status === "missing" ? undefined : state.sqrtPriceX96;
  const priceLocked = state.status === "live" && state.liquidity > 0n;
  // a swap needs a price to move to; an empty pool already at the target is seeded as it is
  const realignFrom = !priceLocked && current !== undefined && current !== target ? current : undefined;
  return {
    child,
    childIsToken0,
    token0,
    token1,
    sqrtPriceX96: priceLocked && current !== undefined ? current : target,
    range: fullRange(state.status === "missing" ? NEW_POOL_TICK_SPACING : state.tickSpacing),
    create: state.status === "missing",
    realign: realignFrom !== undefined,
    realignFrom,
    priceLocked,
  };
}

type ResolvedPool = ReturnType<typeof resolvePool>;

interface Build {
  list: LiquidityAllowList;
  owner: Address;
  deadline: bigint;
}

/**
 * L3's self-realign of an empty pool: a dust mint at its own price, a swap against it to the target, and the
 * dust's withdrawal. `childSpend`/`outcomeSpend` are what it has out of the wallet before the withdrawal returns it.
 */
function realignSteps(id: string, pool: ResolvedPool, current: bigint, b: Build) {
  const { token0, token1, sqrtPriceX96: target } = pool;
  const { sqrtA, sqrtB, tickLower, tickUpper } = pool.range;
  const l0 = liquidityForAmount0(current, sqrtB, REALIGN_DUST_WEI);
  const l1 = liquidityForAmount1(sqrtA, current, REALIGN_DUST_WEI);
  const amount0 = l0 < l1 ? REALIGN_DUST_WEI : amount0Delta(current, sqrtB, l1, true);
  const amount1 = l0 < l1 ? amount1Delta(sqrtA, current, l0, true) : REALIGN_DUST_WEI;
  const dust = {
    token0,
    token1,
    tickLower,
    tickUpper,
    amount0,
    amount1,
    ...tickHeld(current, sqrtA, sqrtB, amount0, amount1),
  };
  const { liquidity } = mintAt(current, sqrtA, sqrtB, amount0, amount1);

  const rising = target > current;
  // the pool's fee is not an input, so the cap's only margin over the exact need is LIQUIDITY_SLIPPAGE_BPS
  const need = rising ? amount1Delta(current, target, liquidity, true) : amount0Delta(target, current, liquidity, true);
  const amountIn = need + (need * SLIPPAGE) / BPS;
  const [tokenIn, tokenOut] = rising ? [token1, token0] : [token0, token1];
  const swap: FlowTx = {
    to: b.list.swaprRouter,
    data: encodeFunctionData({
      abi: ALGEBRA_ROUTER_ABI,
      functionName: "exactInputSingle",
      // limitSqrtPrice bounds the price and amountIn the spend, against the run's own dust
      args: [
        {
          tokenIn,
          tokenOut,
          recipient: b.owner,
          deadline: b.deadline,
          amountIn,
          amountOutMinimum: 0n,
          limitSqrtPrice: target,
        },
      ],
    }),
  };

  const steps: LiquidityStep[] = [
    ...approvals(`${id}:dust`, b.list.positionManager, [
      [token0, amount0],
      [token1, amount1],
    ]),
    { id: `${id}:dust`, tx: multicallTx(b.list, [mintCall(dust, b.owner, b.deadline)]) },
    ...approvals(`${id}:swap`, b.list.swaprRouter, [[tokenIn, amountIn]]),
    { id: `${id}:swap`, tx: swap },
    {
      id: `${id}:dust-withdraw`,
      withdraws: `${id}:dust`,
      // a capped swap stops anywhere between `current` and `target`; amount0 falls and amount1 rises with the price
      build: ({ tokenId }) =>
        withdrawTx(
          b.list,
          b.owner,
          tokenId,
          liquidity,
          held(
            lessSlippage(amount0Delta(rising ? target : current, sqrtB, liquidity, false)),
            lessSlippage(amount1Delta(sqrtA, rising ? current : target, liquidity, false)),
          ),
          b.deadline,
        ),
    },
  ];
  const spendOf = (token: Address) => (token === token0 ? amount0 : amount1) + (token === tokenIn ? amountIn : 0n);
  const outcome = pool.childIsToken0 ? token1 : token0;
  return { steps, childSpend: spendOf(pool.child), outcomeSpend: spendOf(outcome) };
}

/** The outcome-token side of a full-range mint whose child side is `childBudget`. */
function outcomeNeed(pool: ResolvedPool, childBudget: bigint) {
  const { sqrtA, sqrtB } = pool.range;
  const sqrtP = pool.sqrtPriceX96;
  return pool.childIsToken0
    ? amount1Delta(sqrtA, sqrtP, liquidityForAmount0(sqrtP, sqrtB, childBudget), true)
    : amount0Delta(sqrtP, sqrtB, liquidityForAmount1(sqrtA, sqrtP, childBudget), true);
}

function poolPlan(pool: ResolvedPool, childBudget: bigint, outcomeBudget: bigint): PoolPlan {
  const { tickLower, tickUpper, sqrtA, sqrtB } = pool.range;
  const sqrtP = pool.sqrtPriceX96;
  const [budget0, budget1] = pool.childIsToken0 ? [childBudget, outcomeBudget] : [outcomeBudget, childBudget];
  const { liquidity, amount0, amount1 } = mintAt(sqrtP, sqrtA, sqrtB, budget0, budget1);
  return {
    token0: pool.token0,
    token1: pool.token1,
    tickLower,
    tickUpper,
    sqrtPriceX96: sqrtP,
    liquidity,
    amount0,
    amount1,
    ...(pool.priceLocked
      ? held(lessSlippage(amount0), lessSlippage(amount1))
      : tickHeld(sqrtP, sqrtA, sqrtB, amount0, amount1)),
    create: pool.create,
    realign: pool.realign,
    priceLocked: pool.priceLocked,
  };
}

const childAmount = (pool: PoolPlan, child: Address) => (pool.token0 === child ? pool.amount0 : pool.amount1);

/** The transactions of a seed or add run, in order, with the amounts and leftovers its popup shows (L1-L3, L7). */
export function planSeed(input: SeedInput): SeedPlan {
  const { session, owner, total, chainTime } = input;
  const list = listFor(session.chainId);
  // the parent split mints every branch's outcome, so each one needs a plan for its leftovers to be listed
  if (input.branches.length !== session.branches.length) throw new Error("A seed plans every branch of the session.");
  const b: Build = {
    list,
    owner,
    deadline: chainTime + LIQUIDITY_DEADLINE_SECONDS,
  };

  let cap: bigint | undefined;
  if (input.collateral === "xDAI") {
    if (input.previewDeposit === undefined) throw new Error("An xDAI seed needs previewDeposit.");
    cap = input.previewDeposit - (input.previewDeposit * MINT_RATE_MARGIN_BPS) / BPS;
  }
  const depths = input.branches.map(({ depth }) => (cap !== undefined && depth > cap ? cap : depth));
  const parentSplit = depths.reduce((max, depth) => (depth > max ? depth : max), 0n);
  if (input.collateral === "sDAI" && parentSplit > total) throw new Error("The deepest branch needs more than T.");
  // splitFromBase splits every share T deposits: at least `cap` of each parent outcome
  const minted = cap ?? parentSplit;

  const steps: LiquidityStep[] =
    input.collateral === "sDAI"
      ? [
          ...approvals("parent", list.gnosisRouter, [[session.collateral, parentSplit]]),
          {
            id: "parent:split",
            tx: routerTx(list, "splitPosition", session.collateral, session.parentMarket, parentSplit),
          },
        ]
      : [
          {
            id: "parent:split",
            tx: {
              to: list.gnosisRouter,
              value: total,
              data: encodeFunctionData({
                abi: gnosisRouterAbi,
                functionName: "splitFromBase",
                args: [session.parentMarket],
              }),
            },
          },
        ];
  const leftovers: Leftover[] = [
    ...(input.collateral === "sDAI" ? [{ token: session.collateral, amount: total - parentSplit }] : []),
    { token: session.parentInvalid, amount: minted },
  ];

  const branches = input.branches.map((branchInput, index): BranchPlan => {
    const tokens = session.branches[index];
    if (!tokens) throw new Error(`Branch ${index} is not of this session.`);
    const { upPriceBps } = branchInput;
    if (upPriceBps < MIN_SEED_PRICE_BPS || upPriceBps > MAX_SEED_PRICE_BPS) {
      throw new Error(`An UP price of ${upPriceBps} bps is outside the seed range.`);
    }
    const downPriceBps = BPS - upPriceBps;
    const depth = depths[index]!;
    const split = depth / 2n;
    const id = `branch:${index}`;
    steps.push(...approvals(id, list.gnosisRouter, [[tokens.outcome, split]]), {
      id: `${id}:split`,
      tx: routerTx(list, "splitPosition", session.collateral, tokens.childMarket, split),
    });

    const sides = [
      resolvePool(tokens.outcome, tokens.upToken, upPriceBps, branchInput.pools.up),
      resolvePool(tokens.outcome, tokens.downToken, downPriceBps, branchInput.pools.down),
    ] as const;
    const realigns = sides.map((pool, at) =>
      pool.realignFrom === undefined
        ? undefined
        : realignSteps(`${id}:${at === 0 ? "up" : "down"}`, pool, pool.realignFrom, b),
    );
    for (const realign of realigns) if (realign) steps.push(...realign.steps);

    const childBudgets = realigns.map((realign) => split - (realign?.childSpend ?? 0n));
    const outcomeBudget = realigns.reduce((left, realign) => left - (realign?.outcomeSpend ?? 0n), depth - split);
    const needs = sides.map((pool, at) => outcomeNeed(pool, childBudgets[at]!));
    const needed = needs[0]! + needs[1]!;
    const upOutcome = needed <= outcomeBudget ? needs[0]! : (outcomeBudget * needs[0]!) / needed;
    const downOutcome = needed <= outcomeBudget ? needs[1]! : outcomeBudget - upOutcome;
    const up = poolPlan(sides[0], childBudgets[0]!, upOutcome);
    const down = poolPlan(sides[1], childBudgets[1]!, downOutcome);

    steps.push(
      ...approvals(
        `${id}:seed`,
        list.positionManager,
        [up, down].flatMap((pool): [Address, bigint][] => [
          [pool.token0, pool.amount0],
          [pool.token1, pool.amount1],
        ]),
      ),
      {
        id: `${id}:seed`,
        tx: multicallTx(
          list,
          [up, down].flatMap((pool) => [
            ...(pool.create
              ? [
                  encodeFunctionData({
                    abi: POSITION_MANAGER_ABI,
                    functionName: "createAndInitializePoolIfNecessary",
                    args: [pool.token0, pool.token1, pool.sqrtPriceX96],
                  }),
                ]
              : []),
            mintCall(pool, owner, b.deadline),
          ]),
        ),
      },
    );

    const upChild = childAmount(up, tokens.upToken);
    const downChild = childAmount(down, tokens.downToken);
    const outcomeUsed = up.amount0 + up.amount1 - upChild + down.amount0 + down.amount1 - downChild;
    leftovers.push(
      { token: tokens.outcome, amount: minted - split - outcomeUsed },
      { token: tokens.upToken, amount: split - upChild },
      { token: tokens.downToken, amount: split - downChild },
      { token: tokens.invalidToken, amount: split },
    );
    return { depth, split, upPriceBps, downPriceBps, pools: { up, down } };
  });

  return { parentSplit, branches, leftovers: leftovers.filter(({ amount }) => amount > 0n), steps };
}

/** One multicall taking all of a position's liquidity out, collecting everything owed to `owner`, then burning it. */
function withdrawTx(
  list: LiquidityAllowList,
  owner: Address,
  tokenId: bigint,
  liquidity: bigint,
  mins: { amount0Min: bigint; amount1Min: bigint },
  deadline: bigint,
): FlowTx {
  return multicallTx(list, [
    encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "decreaseLiquidity",
      args: [{ tokenId, liquidity, ...mins, deadline }],
    }),
    encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "collect",
      args: [{ tokenId, recipient: owner, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
    }),
    encodeFunctionData({ abi: POSITION_MANAGER_ABI, functionName: "burn", args: [tokenId] }),
  ]);
}

/** A full withdrawal of a position: its liquidity out, everything owed to the owner, the emptied NFT burned (L6). */
export function planRemove(input: RemoveInput): RemovePlan {
  const { position, owner, sqrtPriceX96: sqrtP } = input;
  const list = listFor(input.chainId);
  const sqrtA = sqrtPriceAtTick(position.tickLower);
  const sqrtB = sqrtPriceAtTick(position.tickUpper);
  const amount0 = amount0Delta(sqrtP, sqrtB, position.liquidity, false);
  const amount1 = amount1Delta(sqrtA, sqrtP, position.liquidity, false);
  const mins = held(lessSlippage(amount0), lessSlippage(amount1));
  const deadline = input.chainTime + LIQUIDITY_DEADLINE_SECONDS;
  const tx = withdrawTx(list, owner, position.tokenId, position.liquidity, mins, deadline);
  return { amount0, amount1, ...mins, tx };
}

const min = (...values: bigint[]) => values.reduce((least, value) => (value < least ? value : least));

/** Complete sets back to sDAI: each branch's min(UP, DOWN, INVALID), then every parent outcome's (L6). */
export function planMerge(input: MergeInput): MergePlan {
  const { session, balances } = input;
  const list = listFor(session.chainId);
  const txs: FlowTx[] = [];
  const merge = (market: Address, tokens: Address[], amount: bigint) => {
    if (amount === 0n) return;
    for (const token of tokens) txs.push(approveTx(token, list.gnosisRouter, amount));
    txs.push(routerTx(list, "mergePositions", session.collateral, market, amount));
  };

  const branches = session.branches.map((tokens, index) => {
    const balance = balances.branches[index];
    if (!balance) throw new Error(`No balances for branch ${index}.`);
    const amount = min(balance.up, balance.down, balance.invalid);
    merge(tokens.childMarket, [tokens.upToken, tokens.downToken, tokens.invalidToken], amount);
    return { merge: amount, outcome: balance.outcome + amount };
  });
  const parentMerge = min(...branches.map(({ outcome }) => outcome), balances.parentInvalid);
  merge(session.parentMarket, [...session.branches.map(({ outcome }) => outcome), session.parentInvalid], parentMerge);

  return { branches: branches.map(({ merge: amount }) => ({ merge: amount })), parentMerge, txs };
}

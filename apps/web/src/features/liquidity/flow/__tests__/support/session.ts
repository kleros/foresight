import type { FlowTx } from "@foresight/tx-orchestrator";
import { decodeFunctionData, isAddressEqual, parseAbi, slice, type Address, type Hex } from "viem";

import { ALGEBRA_ROUTER_ABI } from "@/lib/swap/algebraRouter";
import { sqrtPriceAtTick } from "@/lib/swap/tickMath";

import { gnosisRouterAbi } from "@/config/contracts";

import { LIQUIDITY_ALLOW_LIST } from "../../../oracle/allowlist";

/**
 * Fixtures and an independent oracle for the liquidity plan tests.
 *
 * The API these tests hold `flow/plan.ts` and `flow/allowed.ts` to:
 *
 *   planSeed({ session, owner, total, collateral: "sDAI" | "xDAI", previewDeposit?, chainTime,
 *              branches: [{ depth, upPriceBps, pools: { up: PoolState, down: PoolState } }] })
 *     → { parentSplit, branches: [{ depth, split, upPriceBps, downPriceBps, pools: { up, down } }],
 *         leftovers: [{ token, amount }], steps: LiquidityStep[] }
 *     pool plan: { token0, token1, tickLower, tickUpper, sqrtPriceX96, liquidity, amount0, amount1,
 *                  amount0Min, amount1Min, create, realign, priceLocked }
 *     PoolState: { status: "missing" } | { status: "empty"; sqrtPriceX96; tickSpacing }
 *              | { status: "live"; sqrtPriceX96; liquidity; tickSpacing }
 *     LiquidityStep: { id; tx } | { id; withdraws: <id of the dust mint step>; build({ tokenId, sqrtPriceX96 }) → FlowTx }
 *       The dust position's tokenId is known only once its mint lands, so its withdrawal is built from it and
 *       the pool's price read at build.
 *   planRemove({ chainId, owner, chainTime, sqrtPriceX96,
 *                positions: [{ tokenId, token0, token1, tickLower, tickUpper, liquidity }] })
 *     → { amount0, amount1, amount0Min, amount1Min, tx }   // amounts summed; positions of one pool, each named once
 *   planMerge({ session, owner, balances: { branches: [{ outcome, up, down, invalid }], parentInvalid } })
 *     → { branches: [{ merge }], parentMerge, txs }
 *   departures({ tx, session, owner, from? }) → string[];  assertListed(same) throws UnlistedTxError
 */

export const LIST = LIQUIDITY_ALLOW_LIST[100]!;
export const Q96 = 2n ** 96n;
export const BPS = 10_000n;
export const MAX_UINT128 = 2n ** 128n - 1n;
const MAX_TICK = 887272;

export const NFPM_ABI = parseAbi([
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function createAndInitializePoolIfNecessary(address token0, address token1, uint160 sqrtPriceX96) payable returns (address pool)",
  "function mint((address token0, address token1, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint256 amount0, uint256 amount1)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)",
  "function burn(uint256 tokenId) payable",
]);
export const APPROVE_ABI = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

export const owner: Address = "0x00000000000000000000000000000000000000a1";
export const stranger: Address = "0x00000000000000000000000000000000000000ee";
/** Gnosis sDAI: the collateral Seer's router splits and merges against. */
export const sDai: Address = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
export const parentMarket: Address = "0x00000000000000000000000000000000000000b0";
export const parentInvalid: Address = "0x00000000000000000000000000000000000000b9";
export const CHAIN_TIME = 1_900_000_000n;

const at = (prefix: string): Address => `0x${prefix.padEnd(40, "0")}` as Address;

export interface BranchTokens {
  childMarket: Address;
  outcome: Address;
  upToken: Address;
  downToken: Address;
  invalidToken: Address;
}

/**
 * Branch `index` of a session. The parent outcome sits at 0x80…; a child token placed below it is its
 * pool's token0, above it token1, so `childIsToken0` picks the ordering of each pool.
 */
export function branch(index: number, childIsToken0 = { up: true, down: false }): BranchTokens {
  return {
    childMarket: at(`c${index}`),
    outcome: at(`8${index}`),
    upToken: at(`${childIsToken0.up ? "1" : "f"}${index}a`),
    downToken: at(`${childIsToken0.down ? "1" : "f"}${index}d`),
    invalidToken: at(`5${index}`),
  };
}

export function session(branches: BranchTokens[] = [branch(1), branch(2)]) {
  return { chainId: 100, parentMarket, collateral: sDai, parentInvalid, branches };
}

export type PoolStateInput =
  | { status: "missing" }
  | { status: "empty"; sqrtPriceX96: bigint; tickSpacing: number }
  | { status: "live"; sqrtPriceX96: bigint; liquidity: bigint; tickSpacing: number };

export const missing: PoolStateInput = { status: "missing" };

// ---------------------------------------------------------------- oracle maths (Algebra / Uniswap v3 periphery)

const mulDiv = (a: bigint, b: bigint, d: bigint) => (a * b) / d;
const mulDivUp = (a: bigint, b: bigint, d: bigint) => (a * b + d - 1n) / d;
const divUp = (a: bigint, d: bigint) => (a + d - 1n) / d;

export function isqrtOracle(value: bigint): bigint {
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}

export const fullRangeTick = (spacing: number) => Math.floor(MAX_TICK / spacing) * spacing;

export function fullRange(spacing: number) {
  const tick = fullRangeTick(spacing);
  return { tickLower: -tick, tickUpper: tick, sqrtA: sqrtPriceAtTick(-tick), sqrtB: sqrtPriceAtTick(tick) };
}

/** The pool sqrt price for a child token priced at `bps` of the parent outcome. */
export const userSqrtPrice = (bps: bigint, childIsToken0: boolean) =>
  childIsToken0 ? isqrtOracle((bps * Q96 * Q96) / BPS) : isqrtOracle((Q96 * Q96 * BPS) / bps);

const liquidityForAmount0 = (sqrtA: bigint, sqrtB: bigint, amount0: bigint) =>
  mulDiv(amount0, mulDiv(sqrtA, sqrtB, Q96), sqrtB - sqrtA);
const liquidityForAmount1 = (sqrtA: bigint, sqrtB: bigint, amount1: bigint) => mulDiv(amount1, Q96, sqrtB - sqrtA);

/** LiquidityAmounts.getLiquidityForAmounts, for a price inside the range. */
export function liquidityFor(sqrtP: bigint, sqrtA: bigint, sqrtB: bigint, amount0: bigint, amount1: bigint) {
  const l0 = liquidityForAmount0(sqrtP, sqrtB, amount0);
  const l1 = liquidityForAmount1(sqrtA, sqrtP, amount1);
  return l0 < l1 ? l0 : l1;
}

export const amount0Delta = (lower: bigint, upper: bigint, liquidity: bigint, roundUp: boolean) =>
  roundUp
    ? divUp(mulDivUp(liquidity << 96n, upper - lower, upper), lower)
    : mulDiv(liquidity << 96n, upper - lower, upper) / lower;
export const amount1Delta = (lower: bigint, upper: bigint, liquidity: bigint, roundUp: boolean) =>
  roundUp ? mulDivUp(liquidity, upper - lower, Q96) : mulDiv(liquidity, upper - lower, Q96);

/** What a mint of `desired` pulls from the wallet at `sqrtP` over [sqrtA, sqrtB]. */
export function mintPulls(sqrtP: bigint, sqrtA: bigint, sqrtB: bigint, desired0: bigint, desired1: bigint) {
  const liquidity = liquidityFor(sqrtP, sqrtA, sqrtB, desired0, desired1);
  return {
    liquidity,
    amount0: amount0Delta(sqrtP, sqrtB, liquidity, true),
    amount1: amount1Delta(sqrtA, sqrtP, liquidity, true),
  };
}

/** `sqrtP` moved by `ticks` ticks, up for a positive count. */
export const movedSqrtPrice = (sqrtP: bigint, ticks: number) => (sqrtP * sqrtPriceAtTick(ticks)) / Q96;

// ---------------------------------------------------------------- decoding

export interface MintParams {
  token0: Address;
  token1: Address;
  tickLower: number;
  tickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  recipient: Address;
  deadline: bigint;
}

export type Inner =
  | { name: "create"; token0: Address; token1: Address; sqrtPriceX96: bigint }
  | ({ name: "mint" } & MintParams)
  | {
      name: "decreaseLiquidity";
      tokenId: bigint;
      liquidity: bigint;
      amount0Min: bigint;
      amount1Min: bigint;
      deadline: bigint;
    }
  | { name: "collect"; tokenId: bigint; recipient: Address; amount0Max: bigint; amount1Max: bigint }
  | { name: "burn"; tokenId: bigint };

export type Decoded =
  | { kind: "approve"; token: Address; spender: Address; amount: bigint; value: bigint }
  | { kind: "split"; collateral: Address; market: Address; amount: bigint; value: bigint }
  | { kind: "splitFromBase"; market: Address; value: bigint }
  | { kind: "merge"; collateral: Address; market: Address; amount: bigint; value: bigint }
  | { kind: "multicall"; inner: Inner[]; value: bigint }
  | {
      kind: "swap";
      tokenIn: Address;
      tokenOut: Address;
      recipient: Address;
      deadline: bigint;
      amountIn: bigint;
      amountOutMinimum: bigint;
      limitSqrtPrice: bigint;
      value: bigint;
    };

const same = (a: Address, b: Address) => isAddressEqual(a, b);

function decodeInner(data: Hex): Inner {
  const decoded = decodeFunctionData({ abi: NFPM_ABI, data });
  switch (decoded.functionName) {
    case "createAndInitializePoolIfNecessary": {
      const [token0, token1, sqrtPriceX96] = decoded.args;
      return { name: "create", token0, token1, sqrtPriceX96 };
    }
    case "mint":
      return { name: "mint", ...decoded.args[0] };
    case "decreaseLiquidity":
      return { name: "decreaseLiquidity", ...decoded.args[0] };
    case "collect":
      return { name: "collect", ...decoded.args[0] };
    case "burn":
      return { name: "burn", tokenId: decoded.args[0] };
    default:
      throw new Error(`unexpected inner call ${decoded.functionName}`);
  }
}

/** Reads a built transaction back into what it does, by its target and the real ABIs. */
export function decode(tx: FlowTx): Decoded {
  const data = tx.data ?? "0x";
  const value = tx.value ?? 0n;
  if (same(tx.to, LIST.positionManager)) {
    const decoded = decodeFunctionData({ abi: NFPM_ABI, data });
    if (decoded.functionName !== "multicall")
      throw new Error(`position manager ${decoded.functionName} outside a multicall`);
    return { kind: "multicall", inner: decoded.args[0].map(decodeInner), value };
  }
  if (same(tx.to, LIST.gnosisRouter)) {
    const decoded = decodeFunctionData({ abi: gnosisRouterAbi, data });
    if (decoded.functionName === "splitFromBase") return { kind: "splitFromBase", market: decoded.args[0], value };
    if (decoded.functionName === "splitPosition") {
      const [collateral, market, amount] = decoded.args;
      return { kind: "split", collateral, market, amount, value };
    }
    if (decoded.functionName === "mergePositions") {
      const [collateral, market, amount] = decoded.args;
      return { kind: "merge", collateral, market, amount, value };
    }
    throw new Error(`unexpected router call ${decoded.functionName}`);
  }
  if (same(tx.to, LIST.swaprRouter)) {
    const [params] = decodeFunctionData({ abi: ALGEBRA_ROUTER_ABI, data }).args;
    return { kind: "swap", ...params, value };
  }
  if (slice(data, 0, 4) !== "0x095ea7b3") throw new Error(`unexpected call ${data.slice(0, 10)} on ${tx.to}`);
  const [spender, amount] = decodeFunctionData({ abi: APPROVE_ABI, data }).args;
  return { kind: "approve", token: tx.to, spender, amount, value };
}

// ---------------------------------------------------------------- plan helpers

export interface StepLike {
  id: string;
  tx?: FlowTx;
  withdraws?: string;
  build?: (at: { tokenId: bigint; sqrtPriceX96: bigint }) => FlowTx;
}

/**
 * Each step's transaction, building a dust withdrawal from token id `dustTokenId(stepIndex)` at the price the swap
 * before it is limited to, where a run's own swap leaves the pool.
 */
export function txsOf(steps: readonly StepLike[], dustTokenId = (index: number) => 9_000n + BigInt(index)): FlowTx[] {
  let limit: bigint | undefined;
  return steps.map((step, index) => {
    if (step.tx) {
      const decoded = same(step.tx.to, LIST.swaprRouter) ? decode(step.tx) : undefined;
      if (decoded?.kind === "swap") limit = decoded.limitSqrtPrice;
      return step.tx;
    }
    if (!step.build || limit === undefined) throw new Error(`step ${step.id} has neither tx nor a swap before it`);
    return step.build({ tokenId: dustTokenId(index), sqrtPriceX96: limit });
  });
}

type Session = ReturnType<typeof session>;

/** The tokens a router split or merge of `market` pulls from the wallet. */
function routerPulls(s: Session, kind: "split" | "merge", market: Address): Address[] {
  if (same(market, s.parentMarket)) {
    return kind === "split" ? [s.collateral] : [...s.branches.map((b) => b.outcome), s.parentInvalid];
  }
  const b = s.branches.find((each) => same(each.childMarket, market));
  if (!b) throw new Error(`market ${market} is not of this session`);
  return kind === "split" ? [b.outcome] : [b.upToken, b.downToken, b.invalidToken];
}

/**
 * Walks `txs` in order and reports every approval that is not exactly what the next call pulling that
 * token through that spender can take: a mint's desired amounts, a split's or merge's amount, a swap's input.
 */
export function approvalMismatches(s: Session, txs: readonly FlowTx[]): string[] {
  const allowance = new Map<string, bigint>();
  const key = (token: Address, spender: Address) => `${token.toLowerCase()}|${spender.toLowerCase()}`;
  const out: string[] = [];
  const consume = (token: Address, spender: Address, need: bigint, at: number) => {
    const has = allowance.get(key(token, spender)) ?? 0n;
    if (has !== need) out.push(`tx ${at}: ${token} approved ${has} to ${spender}, the call pulls up to ${need}`);
    allowance.delete(key(token, spender));
  };
  txs.forEach((tx, at) => {
    const d = decode(tx);
    if (d.kind === "approve") allowance.set(key(d.token, d.spender), d.amount);
    if (d.kind === "split" || d.kind === "merge") {
      for (const token of routerPulls(s, d.kind, d.market)) consume(token, LIST.gnosisRouter, d.amount, at);
    }
    if (d.kind === "swap") consume(d.tokenIn, LIST.swaprRouter, d.amountIn, at);
    if (d.kind === "multicall") {
      const need = new Map<string, { token: Address; amount: bigint }>();
      const add = (token: Address, amount: bigint) => {
        const k = token.toLowerCase();
        need.set(k, { token, amount: (need.get(k)?.amount ?? 0n) + amount });
      };
      for (const call of d.inner) {
        if (call.name !== "mint") continue;
        add(call.token0, call.amount0Desired);
        add(call.token1, call.amount1Desired);
      }
      for (const { token, amount } of need.values()) consume(token, LIST.positionManager, amount, at);
    }
  });
  for (const [k, amount] of allowance) if (amount !== 0n) out.push(`approval ${k} of ${amount} that no call pulls`);
  return out;
}

export const mintsOf = (txs: readonly FlowTx[]) =>
  txs.flatMap((tx, index) => {
    const d = decode(tx);
    return d.kind === "multicall"
      ? d.inner.flatMap((call) => (call.name === "mint" ? [{ index, mint: call }] : []))
      : [];
  });

export interface PoolPlanLike {
  token0: Address;
  token1: Address;
  amount0: bigint;
  amount1: bigint;
}

/** The index of the transaction carrying the seed mint of `pool`, and that mint. */
export function seedMintOf(txs: readonly FlowTx[], pool: PoolPlanLike) {
  const found = mintsOf(txs).filter(
    ({ mint }) =>
      same(mint.token0, pool.token0) &&
      same(mint.token1, pool.token1) &&
      mint.amount0Desired === pool.amount0 &&
      mint.amount1Desired === pool.amount1,
  );
  if (found.length !== 1)
    throw new Error(`expected one seed mint for ${pool.token0}/${pool.token1}, found ${found.length}`);
  return found[0]!;
}

export const sortPair = (a: Address, b: Address): [Address, Address] => (BigInt(a) < BigInt(b) ? [a, b] : [b, a]);

export const leftoverOf = (leftovers: readonly { token: Address; amount: bigint }[], token: Address) =>
  leftovers.filter((each) => same(each.token, token)).reduce((sum, each) => sum + each.amount, 0n);

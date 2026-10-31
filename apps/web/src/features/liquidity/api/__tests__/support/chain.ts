import {
  createPublicClient,
  custom,
  http,
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  keccak256,
  isAddressEqual,
  multicall3Abi,
  parseAbi,
  RpcRequestError,
  slice,
  toHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { gnosis } from "viem/chains";

import { tickAtSqrtPrice } from "@/lib/swap/tickMath";

import { LIQUIDITY_ALLOW_LIST } from "../../../oracle/allowlist";

/**
 * A fake Gnosis chain behind a real viem `PublicClient`, and the API these tests hold
 * `features/liquidity/api/` to:
 *
 *   getLiquidityPools.ts
 *     fetchLiquidityPools(client: PublicClient, { chainId, parentMarket, childMarkets })
 *       → Promise<SessionPools>
 *       childMarkets[i] is the child market of parent outcome i.
 *     SessionPools = { session: LiquiditySession; branches: { up: PoolState; down: PoolState }[] }
 *       branches[i] belongs to session.branches[i]: `outcome` = parent.wrappedOutcome(i),
 *       `downToken`/`upToken`/`invalidToken` = child.wrappedOutcome(0/1/2), `parentInvalid` =
 *       parent.wrappedOutcome(childMarkets.length). `up` is the pool of (upToken, outcome), `down` of
 *       (downToken, outcome), each from `poolByPair` on the allow list's `algebraFactory`.
 *     sessionHasLiquidity(pools: SessionPools) → boolean
 *     liquidityKeyPrefix: readonly unknown[]   every liquidity read's query key starts with it
 *     useLiquidityPools({ parentMarket, childMarkets } | undefined) → UseQueryResult<SessionPools>
 *       reads through `publicClient` from "@/lib/web3/public-client" on DEFAULT_CHAIN_ID
 *
 *   getLiquidityPositions.ts
 *     fetchLiquidityPositions(client: PublicClient, { pools: SessionPools; owner: Address })
 *       → Promise<LiquidityPosition[]>
 *     LiquidityPosition = { tokenId, token0, token1, tickLower, tickUpper, liquidity, amount0, amount1 }
 *       amount0/amount1: what decreaseLiquidity of the full liquidity returns at the pool's current price, plus
 *       what `collect` pays after it.
 *     useLiquidityPositions(pools: SessionPools | undefined, owner: Address | undefined)
 *       → UseQueryResult<LiquidityPosition[]>
 *
 * The chain answers `eth_call`, alone or as Multicall3 `aggregate3`, for: a market's `wrappedOutcome`,
 * `numOutcomes` and `parentWrappedOutcome`; the factory's `poolByPair` (either token order); a pool's
 * `globalState`, `liquidity`, `tickSpacing`, `token0` and `token1`; the position manager's `factory`,
 * `balanceOf`, `tokenOfOwnerByIndex`, `positions` and `ownerOf`, and its `multicall` of `collect`, which pays a
 * position's `owed` and reverts unless sent from the account `ownerOf` names. Anything else reverts.
 */

export const LIST = LIQUIDITY_ALLOW_LIST[100]!;
export const Q96 = 2n ** 96n;

const WORLD_ABI: Abi = parseAbi([
  "function wrappedOutcome(uint256 index) view returns (address wrapped1155, bytes data)",
  "function numOutcomes() view returns (uint256)",
  "function parentWrappedOutcome() view returns (address wrapped1155, bytes data)",
  "function poolByPair(address tokenA, address tokenB) view returns (address)",
  "function globalState() view returns (uint160 price, int24 tick, uint16 fee, uint16 timepointIndex, uint8 communityFeeToken0, uint8 communityFeeToken1, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function tickSpacing() view returns (int24)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function factory() view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)",
]);

/** Checksummed, as viem decodes every address it reads back. */
export const at = (prefix: string): Address => getAddress(`0x${prefix.padEnd(40, "0")}`);
export const owner: Address = at("a1");
export const stranger: Address = at("ee");

export const sortPair = (a: Address, b: Address): [Address, Address] => (BigInt(a) < BigInt(b) ? [a, b] : [b, a]);
const pairKey = (a: Address, b: Address) => sortPair(a, b).join("|").toLowerCase();

export interface PoolSetup {
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tickSpacing: number;
}

export interface PositionSetup {
  tokenId: bigint;
  token0: Address;
  token1: Address;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  /** Who `ownerOf` names; defaults to the account it is enumerated under. */
  ownerOf?: Address;
  /** What `collect` pays: its tokensOwed and the fees it has earned; none by default. */
  owed?: { amount0: bigint; amount1: bigint };
  /**
   * Which reads of it revert: its `tokenOfOwnerByIndex`, its `positions` and `ownerOf` (a burned token), one of
   * those two, or its `collect`.
   */
  reverts?: "enumeration" | "reads" | "positions" | "ownerOf" | "collect";
}

export interface BranchTokens {
  childMarket: Address;
  outcome: Address;
  upToken: Address;
  downToken: Address;
  invalidToken: Address;
}

export interface Call {
  to: Address;
  functionName: string;
  args: readonly unknown[];
}

/** Branch `index`'s market and tokens; a distinct address per `wrappedOutcome` index. */
export function branchTokens(index: number): BranchTokens {
  return {
    childMarket: at(`c${index}`),
    outcome: at(`8${index}`),
    downToken: at(`1${index}d`),
    upToken: at(`f${index}a`),
    invalidToken: at(`5${index}`),
  };
}

export interface ChainOptions {
  /** The node refuses an `aggregate3` carrying more calls than this, as an eth_call gas or size cap does. */
  maxCallsPerRequest?: number;
  /**
   * The client reaches the node over HTTP with JSON-RPC batching on, as the app's transport does, and the node
   * refuses a batch of more requests than this, every request in it.
   */
  maxBatchLength?: number;
}

export function createChain(branchCount: number, { maxCallsPerRequest = Infinity, maxBatchLength }: ChainOptions = {}) {
  const parentMarket = at("b0");
  const parentInvalid = at("b9");
  const branches = Array.from({ length: branchCount }, (_, index) => branchTokens(index + 1));
  const pools = new Map<string, { address: Address; token0: Address; token1: Address; state: PoolSetup }>();
  const enumerated = new Map<string, PositionSetup[]>();
  const calls: Call[] = [];
  const refused = new Set<bigint>();
  let ethCalls = 0;
  /** How many requests each HTTP message carried, with maxBatchLength set. */
  const batchLengths: number[] = [];

  const marketOutcomes = new Map<string, Address[]>([
    [parentMarket.toLowerCase(), [...branches.map((each) => each.outcome), parentInvalid]],
    ...branches.map(
      (each) =>
        [each.childMarket.toLowerCase(), [each.downToken, each.upToken, each.invalidToken]] as [string, Address[]],
    ),
  ]);

  const poolAt = (address: Address) => [...pools.values()].find((pool) => isAddressEqual(pool.address, address));
  const positionById = (tokenId: bigint) =>
    [...enumerated.values()].flat().find((position) => position.tokenId === tokenId);

  const holderOf = (position: PositionSetup) => {
    const [enumeratedUnder] = [...enumerated.entries()].find(([, held]) => held.includes(position))!;
    return position.ownerOf ?? (enumeratedUnder as Address);
  };

  function result(to: Address, functionName: string, args: readonly unknown[], from?: Address): unknown {
    const outcomes = marketOutcomes.get(to.toLowerCase());
    if (outcomes) {
      if (functionName === "wrappedOutcome") {
        const token = outcomes[Number(args[0] as bigint)];
        if (!token) throw new Error("no such outcome");
        return [token, "0x"];
      }
      if (functionName === "numOutcomes") return BigInt(outcomes.length - 1);
      if (functionName === "parentWrappedOutcome" && !isAddressEqual(to, parentMarket)) {
        const index = branches.findIndex((each) => isAddressEqual(each.childMarket, to));
        return [branches[index]!.outcome, "0x"];
      }
    }
    if (isAddressEqual(to, LIST.algebraFactory) && functionName === "poolByPair") {
      return pools.get(pairKey(args[0] as Address, args[1] as Address))?.address ?? zeroAddress;
    }
    const pool = poolAt(to);
    if (pool) {
      const { sqrtPriceX96, liquidity, tickSpacing } = pool.state;
      if (functionName === "globalState") return [sqrtPriceX96, tickAtSqrtPrice(sqrtPriceX96), 100, 0, 0, 0, true];
      if (functionName === "liquidity") return liquidity;
      if (functionName === "tickSpacing") return tickSpacing;
      if (functionName === "token0") return pool.token0;
      if (functionName === "token1") return pool.token1;
    }
    if (isAddressEqual(to, LIST.positionManager)) {
      if (functionName === "factory") return LIST.algebraFactory;
      if (functionName === "multicall") {
        return (args[0] as Hex[]).map((call) => {
          const inner = decodeFunctionData({ abi: WORLD_ABI, data: call });
          const answer = result(to, inner.functionName, inner.args ?? [], from);
          return encodeFunctionResult({ abi: WORLD_ABI, functionName: inner.functionName, result: answer });
        });
      }
      if (functionName === "balanceOf") return BigInt(enumerated.get((args[0] as Address).toLowerCase())?.length ?? 0);
      if (functionName === "tokenOfOwnerByIndex") {
        const held = enumerated.get((args[0] as Address).toLowerCase()) ?? [];
        const position = held[Number(args[1] as bigint)];
        if (!position || position.reverts === "enumeration") throw new Error("index out of bounds");
        return position.tokenId;
      }
      const position = positionById(
        functionName === "collect" ? (args[0] as { tokenId: bigint }).tokenId : (args[0] as bigint),
      );
      if (!position || position.reverts === "reads" || position.reverts === functionName) {
        throw new Error("invalid token id");
      }
      if (functionName === "ownerOf") return holderOf(position);
      if (functionName === "collect") {
        if (!from || !isAddressEqual(from, holderOf(position))) throw new Error("Not approved");
        return [position.owed?.amount0 ?? 0n, position.owed?.amount1 ?? 0n];
      }
      if (functionName === "positions") {
        const { token0, token1, tickLower, tickUpper, liquidity } = position;
        return [0n, zeroAddress, token0, token1, tickLower, tickUpper, liquidity, 0n, 0n, 0n, 0n];
      }
    }
    throw new Error(`no ${functionName} on ${to}`);
  }

  function answer(to: Address, data: Hex, from?: Address): { ok: true; data: Hex } | { ok: false } {
    try {
      const { functionName, args = [] } = decodeFunctionData({ abi: WORLD_ABI, data });
      calls.push({ to, functionName, args });
      return {
        ok: true,
        data: encodeFunctionResult({ abi: WORLD_ABI, functionName, result: result(to, functionName, args, from) }),
      };
    } catch {
      return { ok: false };
    }
  }

  const multicall3 = gnosis.contracts.multicall3.address;

  /** Whether a call carries a value `refuseRequestsCarrying` named, so the node refuses any request holding it. */
  function isRefused(callData: Hex) {
    try {
      return (decodeFunctionData({ abi: WORLD_ABI, data: callData }).args ?? []).some(
        (arg) => typeof arg === "bigint" && refused.has(arg),
      );
    } catch {
      return false;
    }
  }

  async function request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    if (method === "eth_chainId") return "0x64";
    if (method !== "eth_call") throw new Error(`unexpected rpc ${method}`);
    ethCalls += 1;
    const [{ to, data, from }] = params as [{ to: Address; data: Hex; from?: Address }];
    if (isAddressEqual(to, multicall3)) {
      const decoded = decodeFunctionData({ abi: multicall3Abi, data });
      if (decoded.functionName !== "aggregate3") throw new Error(`unexpected multicall ${decoded.functionName}`);
      const carriesRefused = decoded.args[0].some((call) => isRefused(call.callData));
      if (decoded.args[0].length > maxCallsPerRequest || carriesRefused) {
        throw new RpcRequestError({
          body: { method, params },
          error: { code: -32000, message: "out of gas" },
          url: "fake",
        });
      }
      const results = decoded.args[0].map((call) => {
        const answered = answer(call.target, call.callData);
        return answered.ok ? { success: true, returnData: answered.data } : { success: false, returnData: "0x" as Hex };
      });
      return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results });
    }
    const answered = answer(to, data, from);
    if (answered.ok) return answered.data;
    // the shape a node gives a reverted eth_call; viem builds it from the JSON-RPC error body
    throw new RpcRequestError({
      body: { method, params },
      error: { code: 3, message: "execution reverted" },
      url: "fake",
    });
  }

  /** One JSON-RPC message as a node answers it over HTTP: its result, or its error object. */
  async function answerMessage(message: { id: number; method: string; params?: unknown }) {
    try {
      return { jsonrpc: "2.0", id: message.id, result: await request(message) };
    } catch (error) {
      const { code, message: text } = (error as { cause?: { code?: number; message?: string } }).cause ?? {};
      return { jsonrpc: "2.0", id: message.id, error: { code: code ?? -32000, message: text ?? "error" } };
    }
  }

  async function fetchFn(_url: string | URL | Request, init?: RequestInit): Promise<Response> {
    const body = JSON.parse(String(init?.body)) as
      { id: number; method: string; params?: unknown } | { id: number; method: string; params?: unknown }[];
    if (Array.isArray(body)) {
      batchLengths.push(body.length);
      const refuse = maxBatchLength !== undefined && body.length > maxBatchLength;
      const answers = refuse
        ? body.map((message) => ({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32005, message: "batch too large" },
          }))
        : await Promise.all(body.map(answerMessage));
      return new Response(JSON.stringify(answers), { headers: { "content-type": "application/json" } });
    }
    batchLengths.push(1);
    return new Response(JSON.stringify(await answerMessage(body)), { headers: { "content-type": "application/json" } });
  }

  /** Configured like the app's own `publicClient`: Gnosis, with multicall batching on. */
  const client: PublicClient = createPublicClient({
    chain: gnosis,
    transport:
      maxBatchLength === undefined
        ? custom({ request })
        : http("http://node.test", { batch: true, fetchFn, retryCount: 0 }),
    batch: { multicall: true },
  });

  return {
    client,
    parentMarket,
    parentInvalid,
    branches,
    markets: { chainId: 100, parentMarket, childMarkets: branches.map((each) => each.childMarket) },
    calls,
    /** JSON-RPC `eth_call` requests made so far: one per round trip, however many reads it carries. */
    ethCalls: () => ethCalls,
    /** How many requests each HTTP message carried, with maxBatchLength set. */
    batchLengths,
    /** Creates the pair's pool, or sets the state of the one already there. */
    setPool(tokenA: Address, tokenB: Address, state: PoolSetup): Address {
      const key = pairKey(tokenA, tokenB);
      const existing = pools.get(key);
      if (existing) {
        existing.state = state;
        return existing.address;
      }
      const [token0, token1] = sortPair(tokenA, tokenB);
      // a pair's pool address is fixed by the pair, as CREATE2 makes it on chain
      const address = getAddress(slice(keccak256(toHex(key)), 12));
      pools.set(key, { address, token0, token1, state });
      return address;
    },
    /** The node refuses, every time, an `aggregate3` whose calls carry `value` as an argument. */
    refuseRequestsCarrying(value: bigint) {
      refused.add(value);
    },
    isRefused,
    /** Lists a position under `account`'s `tokenOfOwnerByIndex`. */
    holdPosition(account: Address, position: PositionSetup) {
      const key = account.toLowerCase();
      enumerated.set(key, [...(enumerated.get(key) ?? []), position]);
    },
  };
}

export type Chain = ReturnType<typeof createChain>;

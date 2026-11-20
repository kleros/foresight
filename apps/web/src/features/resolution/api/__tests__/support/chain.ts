import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  isAddressEqual,
  keccak256,
  multicall3Abi,
  parseAbi,
  RpcRequestError,
  toHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { gnosis } from "viem/chains";

import { sessionFactoryAbi } from "@/config/contracts";

/**
 * A fake Gnosis chain behind a real viem `PublicClient`, and the API these tests hold
 * `features/resolution/api/` to:
 *
 *   getSessionResolution.ts
 *     fetchSessionResolution(client: PublicClient, request: SessionResolutionRequest) → Promise<SessionResolution>
 *     SessionResolutionRequest = { sessionFactory: Address; sessionId: bigint; parentOutcomes?: readonly number[] }
 *       parentOutcomes: the parent outcome indexes whose child to read; every parent option when omitted, none for [].
 *     SessionResolution = { parent: ParentResolution; children: Partial<Record<number, ChildResolution>> }
 *       children is keyed by parent outcome index and holds exactly the requested indexes.
 *     ParentResolution =
 *       | { resolved: false }
 *       | { resolved: true; invalid: boolean; winningOutcomes: number[]; payoutNumerators: bigint[];
 *           payoutDenominator: bigint }
 *       payoutNumerators: one per parent token, numOutcomes() options then INVALID, read from the parent market,
 *         whose templateId() must be Reality's single-select (2) or multi-select (3).
 *       winningOutcomes: the option indexes (INVALID excluded) whose numerator is non-zero, ascending.
 *       invalid: whether the INVALID slot's numerator is non-zero.
 *     ChildResolution =
 *       | { deployed: false }   only when SessionFactory.getSession(sessionId).childMarkets has no entry at that index
 *       | { deployed: true; market: Address } & (
 *           | { resolved: false }
 *           | { resolved: true; invalid: boolean; finalValue: number | null; payoutNumerators: bigint[];
 *               payoutDenominator: bigint })
 *       payoutNumerators: [DOWN, UP, INVALID].
 *       finalValue: the child's answer in the session's unit, de-scaled from 1e18 as `OptionScale` bounds are:
 *         lowerBound + numerators[UP] × (upperBound − lowerBound) / (numerators[DOWN] + numerators[UP]),
 *         with that child's own bounds; null when the child resolved INVALID.
 *     A market is resolved when ConditionalTokens' payoutDenominator of its conditionId is non-zero.
 *     A read that fails rejects the whole call; it never reads as unresolved, not deployed or a zero bound.
 *
 * The chain answers `eth_call`, alone or as Multicall3 `aggregate3`, for: SessionFactory's `getSession`; a Seer
 * market's `conditionId`, `numOutcomes`, `lowerBound`, `upperBound`, `parentMarket`, `parentOutcome`, `templateId`
 * and `realityProxy`; the RealityProxy's and the GnosisRouter's `conditionalTokens`; ConditionalTokens'
 * `payoutDenominator`, `payoutNumerators` (reverts past the last slot, as the public array getter does) and
 * `getOutcomeSlotCount`. Anything else reverts.
 */

/** Seer's live Gnosis deployments; the fake answers at the same addresses. */
export const CONDITIONAL_TOKENS: Address = "0xCeAfDD6bc0bEF976fdCd1112955828E00543c0Ce";
export const REALITY_PROXY: Address = "0xc260ADfAC11f97c001dC143d2a4F45b98e0f2D6C";
export const GNOSIS_ROUTER: Address = "0xeC9048b59b3467415b1a38F63416407eA0c70fB8";

export const WAD = 10n ** 18n;

/** Reality.eth template ids, as Seer stores them on a market. */
export const SCALAR_TEMPLATE = 1;
export const SINGLE_SELECT_TEMPLATE = 2;
export const MULTI_SELECT_TEMPLATE = 3;

const SEER_ABI = parseAbi([
  "function conditionId() view returns (bytes32)",
  "function numOutcomes() view returns (uint256)",
  "function lowerBound() view returns (uint256)",
  "function upperBound() view returns (uint256)",
  "function parentMarket() view returns (address)",
  "function parentOutcome() view returns (uint256)",
  "function templateId() view returns (uint256)",
  "function realityProxy() view returns (address)",
  "function conditionalTokens() view returns (address)",
  "function payoutDenominator(bytes32 conditionId) view returns (uint256)",
  "function payoutNumerators(bytes32 conditionId, uint256 index) view returns (uint256)",
  "function getOutcomeSlotCount(bytes32 conditionId) view returns (uint256)",
]);
const WORLD_ABI: Abi = [...SEER_ABI, ...sessionFactoryAbi];

const at = (prefix: string): Address => getAddress(`0x${prefix.padEnd(40, "0")}`);

/** A child's answer, as Seer's RealityProxy turns it into payouts. */
export type ChildAnswer = { value: bigint } | "invalid";

/** A read that reverts: on a market, the RealityProxy (`conditionalTokens`) or the SessionFactory (`getSession`). */
export type FailingRead =
  | "conditionId"
  | "payoutDenominator"
  | "payoutNumerators"
  | "lowerBound"
  | "upperBound"
  | "numOutcomes"
  | "templateId"
  | "realityProxy"
  | "conditionalTokens"
  | "getSession";

interface MarketState {
  address: Address;
  conditionId: Hex;
  slots: number;
  templateId: number;
  lowerBound: bigint;
  upperBound: bigint;
  parentOutcome: bigint;
  numerators: bigint[] | null;
}

export interface ChainOptions {
  /** Each child's scalar bounds, 1e18-scaled; 0 to 100 by default. */
  bounds?: { lowerBound: bigint; upperBound: bigint }[];
  /** How many children the SessionFactory holds, in parent outcome order; every option by default (phased if fewer). */
  deployedChildren?: number;
  /** The parent's Reality template; multi-select by default. */
  parentTemplate?: number;
  /** What `getSession` reports as `expectedChildCount`; the option count by default. Not the parent's outcome count. */
  expectedChildCount?: number;
}

export function createChain(
  optionCount: number,
  { bounds, deployedChildren, parentTemplate, expectedChildCount }: ChainOptions = {},
) {
  const sessionFactory = at("5f");
  const sessionId = 7n;
  const parentMarket = at("b0");
  const childMarkets = Array.from({ length: deployedChildren ?? optionCount }, (_, index) => at(`c${index + 1}`));

  const condition = (market: Address) => keccak256(toHex(`condition:${market.toLowerCase()}`));
  const parent: MarketState = {
    address: parentMarket,
    conditionId: condition(parentMarket),
    slots: optionCount + 1,
    templateId: parentTemplate ?? MULTI_SELECT_TEMPLATE,
    lowerBound: 0n,
    upperBound: 0n,
    parentOutcome: 0n,
    numerators: null,
  };
  const children: MarketState[] = childMarkets.map((address, index) => ({
    address,
    conditionId: condition(address),
    slots: 3,
    templateId: SCALAR_TEMPLATE,
    lowerBound: bounds?.[index]?.lowerBound ?? 0n,
    upperBound: bounds?.[index]?.upperBound ?? 100n * WAD,
    parentOutcome: BigInt(index),
    numerators: null,
  }));
  const markets = [parent, ...children];
  const marketAt = (address: Address) => markets.find((each) => isAddressEqual(each.address, address));
  const marketOf = (conditionId: Hex) => markets.find((each) => each.conditionId === conditionId);

  const failing = new Set<string>();
  const failKey = (address: Address, read: FailingRead) => `${address.toLowerCase()}:${read}`;
  const guard = (address: Address, read: FailingRead) => {
    if (failing.has(failKey(address, read))) throw new Error(`${read} reverted`);
  };

  function result(to: Address, functionName: string, args: readonly unknown[]): unknown {
    if (isAddressEqual(to, sessionFactory) && functionName === "getSession") {
      guard(to, "getSession");
      if (args[0] !== sessionId) {
        return {
          deployer: zeroAddress,
          parentMarket: zeroAddress,
          childMarkets: [],
          openedAt: 0n,
          completedAt: 0n,
          expectedChildCount: 0n,
          metadataUri: "",
        };
      }
      return {
        deployer: at("de"),
        parentMarket,
        childMarkets,
        openedAt: 1_700_000_000n,
        completedAt: childMarkets.length === optionCount ? 1_700_000_000n : 0n,
        expectedChildCount: BigInt(expectedChildCount ?? optionCount),
        metadataUri: "ipfs://session",
      };
    }
    const market = marketAt(to);
    if (market) {
      const read = functionName as FailingRead;
      guard(to, read);
      if (functionName === "conditionId") return market.conditionId;
      if (functionName === "numOutcomes") return BigInt(market.slots - 1);
      if (functionName === "lowerBound") return market.lowerBound;
      if (functionName === "upperBound") return market.upperBound;
      if (functionName === "realityProxy") return REALITY_PROXY;
      if (functionName === "templateId") return BigInt(market.templateId);
      if (functionName === "parentMarket") return market === parent ? zeroAddress : parentMarket;
      if (functionName === "parentOutcome") return market.parentOutcome;
    }
    if (
      (isAddressEqual(to, REALITY_PROXY) || isAddressEqual(to, GNOSIS_ROUTER)) &&
      functionName === "conditionalTokens"
    ) {
      guard(to, "conditionalTokens");
      return CONDITIONAL_TOKENS;
    }
    if (isAddressEqual(to, CONDITIONAL_TOKENS)) {
      const target = marketOf(args[0] as Hex);
      if (functionName === "getOutcomeSlotCount") return BigInt(target?.slots ?? 0);
      if (!target) throw new Error("condition not prepared");
      if (functionName === "payoutDenominator") {
        guard(target.address, "payoutDenominator");
        return (target.numerators ?? []).reduce((sum, each) => sum + each, 0n);
      }
      if (functionName === "payoutNumerators") {
        guard(target.address, "payoutNumerators");
        const index = Number(args[1] as bigint);
        if (index >= target.slots) throw new Error("index out of bounds");
        return target.numerators?.[index] ?? 0n;
      }
    }
    throw new Error(`no ${functionName} on ${to}`);
  }

  function answer(to: Address, data: Hex): { ok: true; data: Hex } | { ok: false } {
    try {
      const { functionName, args = [] } = decodeFunctionData({ abi: WORLD_ABI, data });
      return {
        ok: true,
        data: encodeFunctionResult({ abi: WORLD_ABI, functionName, result: result(to, functionName, args) }),
      };
    } catch {
      return { ok: false };
    }
  }

  const multicall3 = gnosis.contracts.multicall3.address;
  let rejectAll = false;

  async function request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    if (rejectAll) throw new Error("fetch failed");
    if (method === "eth_chainId") return "0x64";
    if (method !== "eth_call") throw new Error(`unexpected rpc ${method}`);
    const [{ to, data }] = params as [{ to: Address; data: Hex }];
    if (isAddressEqual(to, multicall3)) {
      const decoded = decodeFunctionData({ abi: multicall3Abi, data });
      if (decoded.functionName !== "aggregate3") throw new Error(`unexpected multicall ${decoded.functionName}`);
      const results = decoded.args[0].map((call) => {
        const answered = answer(call.target, call.callData);
        return answered.ok ? { success: true, returnData: answered.data } : { success: false, returnData: "0x" as Hex };
      });
      return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results });
    }
    const answered = answer(to, data);
    if (answered.ok) return answered.data;
    throw new RpcRequestError({
      body: { method, params },
      error: { code: 3, message: "execution reverted" },
      url: "fake",
    });
  }

  /** Configured like the app's own `publicClient`: Gnosis, with multicall batching on. */
  const client: PublicClient = createPublicClient({
    chain: gnosis,
    transport: custom({ request }),
    batch: { multicall: true },
  });

  return {
    client,
    sessionFactory,
    sessionId,
    parentMarket,
    /** The children the SessionFactory holds; `childMarkets[i]` is the child of parent outcome `i`. */
    childMarkets,
    /** The request for the whole session; spread it and add `parentOutcomes` to narrow it. */
    session: { sessionFactory, sessionId },
    /** Resolves the parent with these outcome indexes paying 1 each; index `optionCount` is INVALID. */
    resolveParent(winners: number[]) {
      parent.numerators = Array.from({ length: parent.slots }, (_, index) => (winners.includes(index) ? 1n : 0n));
    },
    /** Resolves child `index` as Seer's RealityProxy does for a scalar answer, 1e18-scaled. */
    resolveChild(index: number, childAnswer: ChildAnswer) {
      const child = children[index]!;
      if (childAnswer === "invalid") {
        child.numerators = [0n, 0n, 1n];
      } else if (childAnswer.value <= child.lowerBound) {
        child.numerators = [1n, 0n, 0n];
      } else if (childAnswer.value >= child.upperBound) {
        child.numerators = [0n, 1n, 0n];
      } else {
        child.numerators = [child.upperBound - childAnswer.value, childAnswer.value - child.lowerBound, 0n];
      }
    },
    /** What the chain holds for a market's condition: its numerators and denominator. */
    payouts(market: Address) {
      const state = marketAt(market)!;
      const numerators = Array.from({ length: state.slots }, (_, index) => state.numerators?.[index] ?? 0n);
      return { payoutNumerators: numerators, payoutDenominator: numerators.reduce((sum, each) => sum + each, 0n) };
    },
    /** Makes one read revert from now on: on a market, `REALITY_PROXY` or `sessionFactory`. */
    fail(target: Address, read: FailingRead) {
      failing.add(failKey(target, read));
    },
    /** Every request rejects from now on, as an unreachable node does. */
    goOffline() {
      rejectAll = true;
    },
  };
}

export type Chain = ReturnType<typeof createChain>;

import { formatEther, parseAbi, zeroAddress, type Address, type Hex, type PublicClient } from "viem";

import { sessionFactoryAbi } from "@/config/contracts";

const MARKET_ABI = parseAbi([
  "function conditionId() view returns (bytes32)",
  "function numOutcomes() view returns (uint256)",
  "function templateId() view returns (uint256)",
  "function realityProxy() view returns (address)",
  "function lowerBound() view returns (uint256)",
  "function upperBound() view returns (uint256)",
]);
const REALITY_PROXY_ABI = parseAbi(["function conditionalTokens() view returns (address)"]);
const CONDITIONAL_TOKENS_ABI = parseAbi([
  "function payoutDenominator(bytes32 conditionId) view returns (uint256)",
  "function payoutNumerators(bytes32 conditionId, uint256 index) view returns (uint256)",
]);

/** Reality.eth's single-select and multi-select templates. */
const CATEGORICAL_TEMPLATES = [2n, 3n];
/** A scalar child's outcome slots: DOWN, UP, INVALID. */
const CHILD_SLOTS = 3;
const DOWN = 0;
const UP = 1;

export interface SessionResolutionRequest {
  sessionFactory: Address;
  sessionId: bigint;
  /** The parent outcome indexes whose child to read; every parent option when omitted. */
  parentOutcomes?: readonly number[];
}

interface Payouts {
  payoutNumerators: bigint[];
  payoutDenominator: bigint;
}

/** `payoutNumerators` holds the parent's options, then INVALID. */
export type ParentResolution =
  | { resolved: false }
  | ({ resolved: true; invalid: boolean; winningOutcomes: number[] } & Payouts);

/** `payoutNumerators` is [DOWN, UP, INVALID]. */
export type ChildResolution =
  | { deployed: false }
  | ({ deployed: true; market: Address } & (
      | { resolved: false }
      | ({ resolved: true; invalid: boolean; finalValue: number | null } & Payouts)
    ));

/** `children` is keyed by parent outcome index and holds exactly the requested indexes. */
export interface SessionResolution {
  parent: ParentResolution;
  children: Partial<Record<number, ChildResolution>>;
}

/**
 * Each market's resolution as ConditionalTokens holds it: resolved once its condition's payout denominator is
 * non-zero. Any failed read rejects the whole call.
 */
export async function fetchSessionResolution(
  client: PublicClient,
  { sessionFactory, sessionId, parentOutcomes }: SessionResolutionRequest,
): Promise<SessionResolution> {
  const { parentMarket, childMarkets } = await client.readContract({
    address: sessionFactory,
    abi: sessionFactoryAbi,
    functionName: "getSession",
    args: [sessionId],
  });
  if (parentMarket === zeroAddress) throw new Error(`Session ${sessionId} does not exist.`);

  const deployedRequested = (parentOutcomes ?? childMarkets.map((_, index) => index)).filter(
    (index) => childMarkets[index] !== undefined,
  );
  const children = deployedRequested.map((index) => childMarkets[index]!);

  const parent = { address: parentMarket, abi: MARKET_ABI } as const;
  const [[numOutcomes, templateId, parentCondition, realityProxy], childConditions, bounds] = await Promise.all([
    client.multicall({
      contracts: [
        { ...parent, functionName: "numOutcomes" },
        { ...parent, functionName: "templateId" },
        { ...parent, functionName: "conditionId" },
        { ...parent, functionName: "realityProxy" },
      ],
      allowFailure: false,
      batchSize: 0,
    }),
    client.multicall({
      contracts: children.map((address) => ({ address, abi: MARKET_ABI, functionName: "conditionId" as const })),
      allowFailure: false,
      batchSize: 0,
    }) as Promise<Hex[]>,
    client.multicall({
      contracts: children.flatMap((address) =>
        (["lowerBound", "upperBound"] as const).map((functionName) => ({ address, abi: MARKET_ABI, functionName })),
      ),
      allowFailure: false,
      batchSize: 0,
    }) as Promise<bigint[]>,
  ]);
  if (!CATEGORICAL_TEMPLATES.includes(templateId)) {
    throw new Error(`Parent market ${parentMarket} has template ${templateId}, not a categorical one.`);
  }
  const options = Number(numOutcomes);
  const requested = parentOutcomes ?? Array.from({ length: options }, (_, index) => index);
  if (requested.some((index) => !Number.isInteger(index) || index < 0 || index >= options)) {
    throw new RangeError(`Parent outcomes ${requested.join(",")} are outside the parent's ${options} options.`);
  }

  const conditionalTokens = await client.readContract({
    address: realityProxy,
    abi: REALITY_PROXY_ABI,
    functionName: "conditionalTokens",
  });

  const conditions = [parentCondition, ...childConditions];
  const slotCounts = [options + 1, ...children.map(() => CHILD_SLOTS)];
  // denominators and numerators in one call, so the resolved flag and the payouts come from the same block
  const payoutReads = (await client.multicall({
    contracts: conditions.flatMap((conditionId, market) => [
      {
        address: conditionalTokens,
        abi: CONDITIONAL_TOKENS_ABI,
        functionName: "payoutDenominator" as const,
        args: [conditionId],
      },
      ...Array.from({ length: slotCounts[market]! }, (_, index) => ({
        address: conditionalTokens,
        abi: CONDITIONAL_TOKENS_ABI,
        functionName: "payoutNumerators" as const,
        args: [conditionId, BigInt(index)] as const,
      })),
    ]),
    allowFailure: false,
    batchSize: 0,
  })) as bigint[];

  let offset = 0;
  const [parentPayouts, ...childPayouts] = slotCounts.map((slots): Payouts | null => {
    const [payoutDenominator, ...payoutNumerators] = payoutReads.slice(offset, offset + slots + 1) as [
      bigint,
      ...bigint[],
    ];
    offset += slots + 1;
    return payoutDenominator === 0n ? null : { payoutNumerators, payoutDenominator };
  });

  const resolutions: Partial<Record<number, ChildResolution>> = {};
  for (const index of requested) resolutions[index] = { deployed: false };
  deployedRequested.forEach((index, position) => {
    const market = children[position]!;
    const payouts = childPayouts[position];
    resolutions[index] = payouts
      ? {
          deployed: true,
          market,
          resolved: true,
          ...childOutcome(payouts.payoutNumerators, bounds[position * 2]!, bounds[position * 2 + 1]!),
          ...payouts,
        }
      : { deployed: true, market, resolved: false };
  });

  return {
    parent: parentPayouts
      ? {
          resolved: true,
          invalid: parentPayouts.payoutNumerators[options] !== 0n,
          winningOutcomes: parentPayouts.payoutNumerators
            .slice(0, options)
            .flatMap((numerator, index) => (numerator === 0n ? [] : [index])),
          ...parentPayouts,
        }
      : { resolved: false },
    children: resolutions,
  };
}

/** The child's answer, 1e18-scaled bounds de-scaled to the session's unit; INVALID pays nothing to DOWN or UP. */
function childOutcome(numerators: bigint[], lowerBound: bigint, upperBound: bigint) {
  const down = numerators[DOWN]!;
  const up = numerators[UP]!;
  if (down + up === 0n) return { invalid: true, finalValue: null };
  return {
    invalid: false,
    finalValue: Number(formatEther(lowerBound + (up * (upperBound - lowerBound)) / (down + up))),
  };
}

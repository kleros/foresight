import { formatEther, parseAbi, type Address, type PublicClient } from "viem";

const MARKET_ABI = parseAbi([
  "function conditionId() view returns (bytes32)",
  "function realityProxy() view returns (address)",
  "function lowerBound() view returns (uint256)",
  "function upperBound() view returns (uint256)",
]);
const REALITY_PROXY_ABI = parseAbi(["function conditionalTokens() view returns (address)"]);
const CONDITIONAL_TOKENS_ABI = parseAbi([
  "function payoutDenominator(bytes32 conditionId) view returns (uint256)",
  "function payoutNumerators(bytes32 conditionId, uint256 index) view returns (uint256)",
]);

/** A scalar child's outcome slots: DOWN, UP, INVALID. */
const CHILD_SLOTS = 3;
const DOWN = 0;
const UP = 1;

/** `childMarkets[i]` is the child market of parent outcome `i`. */
export interface SessionMarkets {
  parentMarket: Address;
  childMarkets: Address[];
}

interface Payouts {
  payoutNumerators: bigint[];
  payoutDenominator: bigint;
}

export type ParentResolution = { resolved: false } | ({ resolved: true; winningOutcomes: number[] } & Payouts);

export type ChildResolution = { market: Address } & (
  { resolved: false } | ({ resolved: true; invalid: boolean; finalValue: number | null } & Payouts)
);

/** `children[i]` belongs to `childMarkets[i]`. */
export interface SessionResolution {
  parent: ParentResolution;
  children: ChildResolution[];
}

/**
 * Each market's resolution as ConditionalTokens holds it: resolved once its condition's payout denominator is
 * non-zero. Any failed read rejects the whole call.
 */
export async function fetchSessionResolution(
  client: PublicClient,
  { parentMarket, childMarkets }: SessionMarkets,
): Promise<SessionResolution> {
  const markets = [parentMarket, ...childMarkets];
  const slotCounts = [childMarkets.length + 1, ...childMarkets.map(() => CHILD_SLOTS)];

  const [realityProxy, conditionIds, bounds] = await Promise.all([
    client.readContract({ address: parentMarket, abi: MARKET_ABI, functionName: "realityProxy" }),
    client.multicall({
      contracts: markets.map((address) => ({ address, abi: MARKET_ABI, functionName: "conditionId" as const })),
      allowFailure: false,
      batchSize: 0,
    }),
    client.multicall({
      contracts: childMarkets.flatMap((address) =>
        (["lowerBound", "upperBound"] as const).map((functionName) => ({ address, abi: MARKET_ABI, functionName })),
      ),
      allowFailure: false,
      batchSize: 0,
    }) as Promise<bigint[]>,
  ]);

  const conditionalTokens = await client.readContract({
    address: realityProxy,
    abi: REALITY_PROXY_ABI,
    functionName: "conditionalTokens",
  });

  // denominators and numerators in one call, so the resolved flag and the payouts come from the same block
  const payoutReads = (await client.multicall({
    contracts: conditionIds.flatMap((conditionId, market) => [
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
  const payouts = slotCounts.map((slots): Payouts | null => {
    const [payoutDenominator, ...payoutNumerators] = payoutReads.slice(offset, offset + slots + 1) as [
      bigint,
      ...bigint[],
    ];
    offset += slots + 1;
    return payoutDenominator === 0n ? null : { payoutNumerators, payoutDenominator };
  });

  const [parentPayouts, ...childPayouts] = payouts;
  return {
    parent: parentPayouts
      ? {
          resolved: true,
          winningOutcomes: parentPayouts.payoutNumerators
            .slice(0, childMarkets.length)
            .flatMap((numerator, index) => (numerator === 0n ? [] : [index])),
          ...parentPayouts,
        }
      : { resolved: false },
    children: childMarkets.map((market, index): ChildResolution => {
      const resolved = childPayouts[index];
      if (!resolved) return { market, resolved: false };
      return {
        market,
        resolved: true,
        ...childOutcome(resolved.payoutNumerators, bounds[index * 2]!, bounds[index * 2 + 1]!),
        ...resolved,
      };
    }),
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

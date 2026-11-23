import { encodeFunctionData, erc20Abi, getAddress, type Address } from "viem";

import { executorAddress, type ExecutorCall } from "@/lib/trade-executor/executor";

import { gnosisRouterAbi, sDaiAddress, tradeExecutorFactoryAddress } from "@/config/contracts";

import type { ChildResolution, ParentResolution, SessionResolution } from "../../../api/getSessionResolution";
import { REDEEM_ALLOW_LIST } from "../../../oracle/allowlist";
import { conditionalRouterAbi } from "../../abi";
import { planTradeWalletRedeem, type RedeemHolding, type TradeWalletRedeemInput } from "../../plan";
import type { RedeemScope } from "../../tradeWalletBatchAllowed";

/** A three-option session on gnosis: options 0 and 1 win, 2 loses; children valued 42, 73 and 10. */

export const CHAIN_ID = 100;
export const LIST = REDEEM_ALLOW_LIST[CHAIN_ID]!;
export const SDAI = sDaiAddress(CHAIN_ID)!;
export const WAD = 10n ** 18n;

const at = (prefix: string): Address => getAddress(`0x${prefix.padEnd(40, "0")}`);

export const OWNER = at("1a01");
export const OTHER_OWNER = at("1a02");
export const PARENT = at("b0");
export const childMarket = (option: number) => at(`c${option + 1}`);
export const parentToken = (index: number) => at(`e0${index}`);
export const childToken = (option: number, slot: number) => at(`d${option}${slot}`);
export const tradeWalletOf = (owner: Address) => executorAddress(tradeExecutorFactoryAddress(CHAIN_ID)!, owner);

export const OPTIONS = 3;
export const DOWN = 0;
export const UP = 1;
export const INVALID = 2;

export const SCOPE: RedeemScope = {
  collateral: SDAI,
  parentMarket: PARENT,
  parentTokens: Array.from({ length: OPTIONS + 1 }, (_, index) => parentToken(index)),
  children: Object.fromEntries(
    Array.from({ length: OPTIONS }, (_, option) => [
      option,
      { market: childMarket(option), tokens: [0, 1, 2].map((slot) => childToken(option, slot)) },
    ]),
  ),
};

export function resolvedParent(numerators: bigint[]): ParentResolution {
  const options = numerators.length - 1;
  return {
    resolved: true,
    invalid: numerators[options] !== 0n,
    winningOutcomes: numerators.slice(0, options).flatMap((each, index) => (each === 0n ? [] : [index])),
    payoutNumerators: numerators,
    payoutDenominator: numerators.reduce((sum, each) => sum + each, 0n),
  };
}

export function valuedChild(option: number, value: bigint): ChildResolution {
  return {
    deployed: true,
    market: childMarket(option),
    resolved: true,
    invalid: false,
    finalValue: Number(value),
    payoutNumerators: [100n * WAD - value * WAD, value * WAD, 0n],
    payoutDenominator: 100n * WAD,
  };
}

export const unresolvedChild = (option: number): ChildResolution => ({
  deployed: true,
  market: childMarket(option),
  resolved: false,
});

export const TWO_WINNERS: SessionResolution = {
  parent: resolvedParent([1n, 1n, 0n, 0n]),
  children: { 0: valuedChild(0, 42n), 1: valuedChild(1, 73n), 2: valuedChild(2, 10n) },
};

export const PARENT_BALANCES = [5n * WAD + 1n, 6n * WAD - 3n, 7n * WAD, 9n * WAD];
export const CHILD_BALANCES = [
  [4n * WAD - 1_234_567_891n, 4n * WAD, 4n * WAD],
  [3n * WAD, 3n * WAD - 987_654_321n, 3n * WAD],
  [2n * WAD, 2n * WAD, 2n * WAD],
];

export function plannerInput(
  overrides: Partial<Pick<TradeWalletRedeemInput, "owner" | "resolution">> & {
    parentBalances?: bigint[];
    childBalances?: bigint[][];
  } = {},
): TradeWalletRedeemInput {
  const parentBalances = overrides.parentBalances ?? PARENT_BALANCES;
  const childBalances = overrides.childBalances ?? CHILD_BALANCES;
  const holding = (token: Address, balance: bigint | undefined): RedeemHolding => ({ token, balance: balance ?? 0n });
  return {
    chainId: CHAIN_ID,
    owner: overrides.owner ?? OWNER,
    collateral: SDAI,
    parentMarket: PARENT,
    resolution: overrides.resolution ?? TWO_WINNERS,
    parentTokens: SCOPE.parentTokens.map((token, index) => holding(token, parentBalances[index])),
    childTokens: Object.fromEntries(
      Array.from({ length: OPTIONS }, (_, option) => [
        option,
        SCOPE.children[option]!.tokens.map((token, slot) => holding(token, childBalances[option]?.[slot])),
      ]),
    ),
  };
}

export const planFor = (overrides: Parameters<typeof plannerInput>[0] = {}) =>
  planTradeWalletRedeem(plannerInput(overrides));

export const approve = (token: Address, spender: Address, amount: bigint): ExecutorCall => ({
  to: token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
});

export const redeemPositions = (
  indexes: bigint[],
  amounts: bigint[],
  { collateral = SDAI, market = PARENT }: { collateral?: Address; market?: Address } = {},
): ExecutorCall => ({
  to: LIST.gnosisRouter,
  data: encodeFunctionData({
    abi: gnosisRouterAbi,
    functionName: "redeemPositions",
    args: [collateral, market, indexes, amounts],
  }),
});

export const redeemChild = (
  option: number,
  indexes: bigint[],
  amounts: bigint[],
  {
    collateral = SDAI,
    market = childMarket(option),
    parentIndexes = [BigInt(option)],
    to = LIST.conditionalRouter,
  }: { collateral?: Address; market?: Address; parentIndexes?: bigint[]; to?: Address } = {},
): ExecutorCall => ({
  to,
  data: encodeFunctionData({
    abi: conditionalRouterAbi,
    functionName: "redeemConditionalToCollateral",
    args: [collateral, market, indexes, parentIndexes, amounts],
  }),
});

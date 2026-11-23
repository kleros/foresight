import {
  decodeFunctionData,
  erc20Abi,
  getAddress,
  isAddressEqual,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { executorAddress } from "@/lib/trade-executor/executor";

import { gnosisRouterAbi, sDaiAddress, tradeExecutorAbi, tradeExecutorFactoryAddress } from "@/config/contracts";

import { fetchSessionResolution, type SessionResolution } from "../getSessionResolution";
import { fetchRedeemScope, fetchTradeWalletRedeem } from "../getTradeWalletRedeem";

vi.mock("../getSessionResolution", () => ({ fetchSessionResolution: vi.fn() }));

const CHAIN_ID = 100;
const at = (prefix: string): Address => getAddress(`0x${prefix.padEnd(40, "0")}`);
const FACTORY = at("5f");
const OWNER = at("1a01");
const PARENT = at("b0");
const CHILDREN = [at("c1"), zeroAddress, at("c3")];
const parentToken = (index: number) => at(`e0${index}`);
const childToken = (market: Address, slot: number) => at(`d${market.slice(3, 4)}${slot}`);
const TRADE_WALLET = executorAddress(tradeExecutorFactoryAddress(CHAIN_ID)!, OWNER);
const WAD = 10n ** 18n;

type Call = { address: Address; functionName: string; args?: readonly unknown[] };

/** The chain as these tests set it: balances by holder and token. */
const balances = new Map<string, bigint>();
const balanceKey = (holder: Address, token: Address) => `${holder.toLowerCase()}:${token.toLowerCase()}`;

const client = {
  readContract: vi.fn(async ({ address, functionName }: Call) => {
    if (functionName === "getSession" && isAddressEqual(address, FACTORY)) {
      return { parentMarket: PARENT, childMarkets: CHILDREN };
    }
    if (functionName === "numOutcomes" && isAddressEqual(address, PARENT)) return 3n;
    throw new Error(`unexpected read ${functionName} on ${address}`);
  }),
  multicall: vi.fn(async ({ contracts }: { contracts: Call[] }) =>
    contracts.map(({ address, functionName, args }) => {
      if (functionName === "wrappedOutcome") {
        const index = Number(args![0]);
        return [isAddressEqual(address, PARENT) ? parentToken(index) : childToken(address, index), "0x"];
      }
      if (functionName === "balanceOf") return balances.get(balanceKey(args![0] as Address, address)) ?? 0n;
      throw new Error(`unexpected multicall ${functionName}`);
    }),
  ),
} as unknown as PublicClient;

/** Options 0 and 2 won; child 0 resolved at 40, child 2 not yet. */
const resolution: SessionResolution = {
  parent: {
    resolved: true,
    invalid: false,
    winningOutcomes: [0, 2],
    payoutNumerators: [1n, 0n, 1n, 0n],
    payoutDenominator: 2n,
  },
  children: {
    0: {
      deployed: true,
      market: CHILDREN[0]!,
      resolved: true,
      invalid: false,
      finalValue: 40,
      payoutNumerators: [60n, 40n, 0n],
      payoutDenominator: 100n,
    },
    1: { deployed: false },
    2: { deployed: true, market: CHILDREN[2]!, resolved: false },
  },
};

const request = { chainId: CHAIN_ID, owner: OWNER, sessionFactory: FACTORY, sessionId: 4n };

function innerCalls(data: `0x${string}`) {
  return decodeFunctionData({ abi: tradeExecutorAbi, data }).args[0] as readonly { to: Address; data: `0x${string}` }[];
}

beforeEach(() => {
  balances.clear();
  vi.mocked(fetchSessionResolution).mockResolvedValue(resolution);
});

describe("fetchRedeemScope", () => {
  it("names sDAI and each deployed market's wrappedOutcome tokens, by parent outcome index", async () => {
    const scope = await fetchRedeemScope(client, request);

    expect(scope.collateral).toBe(sDaiAddress(CHAIN_ID));
    expect(scope.parentMarket).toBe(PARENT);
    expect(scope.parentTokens).toEqual([0, 1, 2, 3].map(parentToken));
    expect(Object.keys(scope.children)).toEqual(["0", "2"]);
    expect(scope.children[2]).toEqual({
      market: CHILDREN[2],
      tokens: [0, 1, 2].map((slot) => childToken(CHILDREN[2]!, slot)),
    });
  });

  it("rejects a session the factory does not hold", async () => {
    vi.mocked(client.readContract).mockResolvedValueOnce({ parentMarket: zeroAddress, childMarkets: [] });

    await expect(fetchRedeemScope(client, request)).rejects.toThrow("does not exist");
  });
});

describe("fetchTradeWalletRedeem", () => {
  it("plans from the owner's trade wallet balances, redeeming into sDAI, and passes the waiting option through", async () => {
    balances.set(balanceKey(TRADE_WALLET, parentToken(0)), 3n * WAD);
    balances.set(balanceKey(OWNER, parentToken(2)), 5n * WAD);
    balances.set(balanceKey(TRADE_WALLET, childToken(CHILDREN[0]!, 1)), 2n * WAD);

    const plan = await fetchTradeWalletRedeem(client, request);

    expect(plan.waiting).toEqual([2]);
    expect(plan.parts).toEqual([
      { market: PARENT, payout: (3n * WAD) / 2n },
      { market: CHILDREN[0], payout: (((2n * WAD * 40n) / 100n) * 1n) / 2n },
    ]);
    expect(plan.tx!.to).toBe(TRADE_WALLET);
    const calls = innerCalls(plan.tx!.data!);
    expect(calls[0]!.to).toBe(parentToken(0));
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[0]!.data }).args).toEqual([expect.any(String), 3n * WAD]);
    const redeem = decodeFunctionData({ abi: gnosisRouterAbi, data: calls[1]!.data });
    expect(redeem.args).toEqual([sDaiAddress(CHAIN_ID), PARENT, [0n], [3n * WAD]]);
    expect(calls[2]!.to).toBe(childToken(CHILDREN[0]!, 1));
  });

  it("lets a failed read reject, so nothing is planned", async () => {
    vi.mocked(fetchSessionResolution).mockRejectedValueOnce(new Error("node down"));

    await expect(fetchTradeWalletRedeem(client, request)).rejects.toThrow("node down");
  });
});

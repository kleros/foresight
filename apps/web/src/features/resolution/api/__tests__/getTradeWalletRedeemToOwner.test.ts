import { decodeFunctionData, erc20Abi, getAddress, isAddressEqual, type Address, type PublicClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { tradeExecutorAbi } from "@/config/contracts";

import {
  CHAIN_ID,
  childMarket,
  childToken,
  OPTIONS,
  OWNER,
  PARENT,
  parentToken,
  SCOPE,
  SDAI,
  tradeWalletOf,
  TWO_WINNERS,
  UP,
  WAD,
} from "../../redeem/__tests__/support/session";
import { ownerPayBatchDepartures } from "../../redeem/payOwner";
import { fetchSessionResolution } from "../getSessionResolution";
import { fetchTradeWalletRedeem } from "../getTradeWalletRedeem";
import { readTradeWalletRedeemToOwner } from "../getTradeWalletRedeemToOwner";

/** A5: the owner transfer's recipient is `owner()` read from the trade wallet on-chain. */

vi.mock("../getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));

const FACTORY: Address = "0x5f00000000000000000000000000000000000000";
const REQUEST = { chainId: CHAIN_ID, owner: OWNER, sessionFactory: FACTORY, sessionId: 7n };
/** Two answers of the trade wallet's `owner()`, neither the connected account, so only an on-chain read finds them. */
const ONCHAIN_OWNERS = [
  getAddress("0x0a11000000000000000000000000000000000000"),
  getAddress("0x0a22000000000000000000000000000000000000"),
];

interface Call {
  address: Address;
  functionName: string;
  args?: readonly unknown[];
}

/** The session, its tokens, the trade wallet's balances, and `owner()` on the trade wallet only. */
function fakeClient(owner: Address | Error) {
  const ownerReads: Address[] = [];
  const balances = [
    { token: parentToken(0), balance: 3n * WAD + 1n },
    { token: childToken(0, UP), balance: 2n * WAD - 5n },
  ];
  const answer = ({ address, functionName, args }: Call): unknown => {
    if (functionName === "getSession") {
      return { parentMarket: PARENT, childMarkets: Array.from({ length: OPTIONS }, (_, i) => childMarket(i)) };
    }
    if (functionName === "numOutcomes") return BigInt(OPTIONS);
    if (functionName === "wrappedOutcome") {
      const index = Number(args![0]);
      if (isAddressEqual(address, PARENT)) return [parentToken(index), "0x"];
      const option = [0, 1, 2].find((each) => isAddressEqual(address, childMarket(each)))!;
      return [childToken(option, index), "0x"];
    }
    if (functionName === "balanceOf") {
      if (!isAddressEqual(args![0] as Address, tradeWalletOf(OWNER))) return 0n;
      return balances.find((each) => isAddressEqual(each.token, address))?.balance ?? 0n;
    }
    if (functionName === "owner") {
      ownerReads.push(address);
      if (!isAddressEqual(address, tradeWalletOf(OWNER))) throw new Error(`owner() of ${address}`);
      if (owner instanceof Error) throw owner;
      return owner;
    }
    throw new Error(`unexpected read ${functionName}`);
  };
  const client = {
    readContract: async (call: Call) => answer(call),
    multicall: async ({ contracts, allowFailure }: { contracts: Call[]; allowFailure?: boolean }) =>
      contracts.map((call) => {
        if (allowFailure === false) return answer(call);
        try {
          return { status: "success", result: answer(call) };
        } catch (error) {
          return { status: "failure", error };
        }
      }),
  } as unknown as PublicClient;
  return { client, ownerReads };
}

function lastCall(data: `0x${string}`) {
  const outer = decodeFunctionData({ abi: tradeExecutorAbi, data });
  if (outer.functionName !== "batchExecute") throw new Error(outer.functionName);
  return outer.args[0].at(-1)!;
}

beforeEach(() => {
  vi.mocked(fetchSessionResolution).mockReset();
  vi.mocked(fetchSessionResolution).mockResolvedValue(TWO_WINNERS);
  vi.mocked(fetchGraphql).mockReset();
});

describe("A5 reading a ticked trade wallet redeem", () => {
  it("pays owner() read from the trade wallet, not the connected account, for two owners", async () => {
    for (const owner of ONCHAIN_OWNERS) {
      const { client, ownerReads } = fakeClient(owner);

      const { plan, scope, payout } = await readTradeWalletRedeemToOwner(client, REQUEST);

      expect(ownerReads.length).toBeGreaterThan(0);
      for (const read of ownerReads) expect(isAddressEqual(read, tradeWalletOf(OWNER))).toBe(true);
      expect(isAddressEqual(payout.owner, owner)).toBe(true);
      expect(payout.resolution).toEqual(TWO_WINNERS);

      const last = lastCall(plan.tx!.data!);
      expect(isAddressEqual(last.to, SDAI)).toBe(true);
      const [recipient, amount] = decodeFunctionData({ abi: erc20Abi, data: last.data }).args as readonly [
        Address,
        bigint,
      ];
      expect(isAddressEqual(recipient, owner)).toBe(true);
      expect(isAddressEqual(recipient, OWNER)).toBe(false);
      expect(amount).toBe(plan.payout);
      expect(ownerPayBatchDepartures({ tx: plan.tx!, chainId: CHAIN_ID, account: OWNER, scope, payout })).toEqual([]);
    }
    expect(fetchGraphql).not.toHaveBeenCalled();
  });

  it("transfers the payout the unticked read plans", async () => {
    const { client } = fakeClient(ONCHAIN_OWNERS[0]!);
    const unticked = await fetchTradeWalletRedeem(client, REQUEST);

    const { plan } = await readTradeWalletRedeemToOwner(client, REQUEST);

    expect(unticked.payout).toBeGreaterThan(0n);
    expect(plan.payout).toBe(unticked.payout);
    expect(plan.parts).toEqual(unticked.parts);
  });

  it("rejects when owner() cannot be read, so nothing is offered", async () => {
    const { client } = fakeClient(new Error("owner() reverted"));
    await expect(readTradeWalletRedeemToOwner(client, REQUEST)).rejects.toThrow();
  });

  it("checks the plan against the session's own scope", async () => {
    const { client } = fakeClient(ONCHAIN_OWNERS[1]!);
    const { scope } = await readTradeWalletRedeemToOwner(client, REQUEST);
    expect(scope).toEqual(SCOPE);
  });
});

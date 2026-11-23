import { isAddressEqual, type Address, type PublicClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAIN_ID,
  childMarket,
  childToken,
  OPTIONS,
  OTHER_OWNER,
  OWNER,
  PARENT,
  parentToken,
  SCOPE,
  tradeWalletOf,
  TWO_WINNERS,
  WAD,
} from "../../redeem/__tests__/support/session";
import { planWalletRedeem } from "../../redeem/plan";
import { fetchSessionResolution } from "../getSessionResolution";
import { fetchWalletRedeemInput } from "../getWalletRedeem";

vi.mock("../getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));

const FACTORY: Address = "0x5f00000000000000000000000000000000000000";
const REQUEST = { chainId: CHAIN_ID, owner: OWNER, sessionFactory: FACTORY, sessionId: 7n };

interface Call {
  address: Address;
  functionName: string;
  args?: readonly unknown[];
}

/** The chain as the fetcher reads it: the session, each market's wrapped tokens, and balances per holder. */
function fakeClient(balances: { holder: Address; token: Address; balance: bigint }[]) {
  const holders: Address[] = [];
  const answer = ({ address, functionName, args }: Call): unknown => {
    if (functionName === "getSession") {
      return { parentMarket: PARENT, childMarkets: SCOPE.parentTokens.slice(0, OPTIONS).map((_, i) => childMarket(i)) };
    }
    if (functionName === "numOutcomes") return BigInt(OPTIONS);
    if (functionName === "wrappedOutcome") {
      const index = Number(args![0]);
      if (isAddressEqual(address, PARENT)) return [parentToken(index), "0x"];
      const option = [0, 1, 2].find((each) => isAddressEqual(address, childMarket(each)))!;
      return [childToken(option, index), "0x"];
    }
    if (functionName === "balanceOf") {
      const holder = args![0] as Address;
      holders.push(holder);
      return (
        balances.find((each) => isAddressEqual(each.holder, holder) && isAddressEqual(each.token, address))?.balance ??
        0n
      );
    }
    throw new Error(`unexpected read ${functionName}`);
  };
  const client = {
    readContract: async (call: Call) => answer(call),
    multicall: async ({ contracts }: { contracts: Call[] }) => contracts.map(answer),
  } as unknown as PublicClient;
  return { client, holders };
}

beforeEach(() => {
  vi.mocked(fetchSessionResolution).mockReset();
  vi.mocked(fetchSessionResolution).mockResolvedValue(TWO_WINNERS);
});

describe("fetchWalletRedeemInput", () => {
  it("reads every session token's balance of the connected account itself, not its trade wallet", async () => {
    const { client, holders } = fakeClient([
      { holder: OWNER, token: parentToken(0), balance: 2n * WAD + 1n },
      { holder: tradeWalletOf(OWNER), token: parentToken(1), balance: WAD },
      { holder: OTHER_OWNER, token: parentToken(1), balance: WAD },
    ]);

    const input = await fetchWalletRedeemInput(client, REQUEST);

    expect(holders).toHaveLength(OPTIONS + 1 + 3 * OPTIONS);
    expect(holders.every((holder) => isAddressEqual(holder, OWNER))).toBe(true);
    expect(input.parentTokens.map(({ balance }) => balance)).toEqual([2n * WAD + 1n, 0n, 0n, 0n]);
    expect(input.owner).toBe(OWNER);
  });

  it("names the session's wrappedOutcome tokens, its parent and the chain's sDAI", async () => {
    const { client } = fakeClient([]);

    const input = await fetchWalletRedeemInput(client, REQUEST);

    expect(input.parentMarket).toBe(PARENT);
    expect(input.collateral).toBe(SCOPE.collateral);
    expect(input.parentTokens.map(({ token }) => token)).toEqual([0, 1, 2, 3].map(parentToken));
    expect(input.childTokens[1]!.map(({ token }) => token)).toEqual([0, 1, 2].map((slot) => childToken(1, slot)));
    expect(input.resolution).toEqual(TWO_WINNERS);
  });

  it("gives the planner what it plans the wallet's parts from", async () => {
    const { client } = fakeClient([{ holder: OWNER, token: parentToken(0), balance: 3n * WAD }]);

    const plan = planWalletRedeem(await fetchWalletRedeemInput(client, REQUEST));

    expect(plan.parts.map(({ market }) => market)).toEqual([PARENT]);
    expect(plan.calls.length).toBeGreaterThan(0);
  });
});

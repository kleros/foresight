import { isAddressEqual, type Address, type PublicClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAIN_ID,
  childMarket,
  childToken,
  OPTIONS,
  OWNER,
  PARENT,
  parentToken,
  SCOPE,
  tradeWalletOf,
  TWO_WINNERS,
  WAD,
} from "../../redeem/__tests__/support/session";
import { fetchSessionResolution } from "../getSessionResolution";
import { fetchWalletRedeemInput } from "../getWalletRedeem";

vi.mock("../getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));

const GNOSIS_SDAI: Address = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
const FACTORY: Address = "0x5f00000000000000000000000000000000000000";
const REQUEST = { chainId: CHAIN_ID, owner: OWNER, sessionFactory: FACTORY, sessionId: 7n };

interface Call {
  address: Address;
  functionName: string;
  args?: readonly unknown[];
}

/** The session, each market's wrapped tokens, and balances per holder. */
function fakeClient(balances: { holder: Address; token: Address; balance: bigint }[]) {
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
      const holder = args![0] as Address;
      return (
        balances.find((each) => isAddressEqual(each.holder, holder) && isAddressEqual(each.token, address))?.balance ??
        0n
      );
    }
    throw new Error(`unexpected read ${functionName}`);
  };
  return {
    readContract: async (call: Call) => answer(call),
    multicall: async ({ contracts }: { contracts: Call[] }) => contracts.map(answer),
  } as unknown as PublicClient;
}

beforeEach(() => {
  vi.mocked(fetchSessionResolution).mockResolvedValue(TWO_WINNERS);
});

describe("fetchWalletRedeemInput", () => {
  it("reads the connected account's own balances of the session's on-chain tokens, not its trade wallet's", async () => {
    const client = fakeClient([
      { holder: OWNER, token: parentToken(0), balance: 5n * WAD },
      { holder: OWNER, token: childToken(1, 1), balance: 2n * WAD },
      { holder: tradeWalletOf(OWNER), token: parentToken(1), balance: 9n * WAD },
    ]);

    const input = await fetchWalletRedeemInput(client, REQUEST);

    expect(input.owner).toBe(OWNER);
    expect(input.collateral).toBe(GNOSIS_SDAI);
    expect(input.parentMarket).toBe(PARENT);
    expect(input.resolution).toBe(TWO_WINNERS);
    expect(input.parentTokens).toEqual(
      SCOPE.parentTokens.map((token, index) => ({ token, balance: index === 0 ? 5n * WAD : 0n })),
    );
    expect(input.childTokens[1]).toEqual(
      SCOPE.children[1]!.tokens.map((token, slot) => ({ token, balance: slot === 1 ? 2n * WAD : 0n })),
    );
  });
});

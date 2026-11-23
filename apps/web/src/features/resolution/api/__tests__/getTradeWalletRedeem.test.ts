import { decodeFunctionData, erc20Abi, isAddressEqual, parseAbi, type Address, type PublicClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { tradeExecutorAbi } from "@/config/contracts";

import {
  CHAIN_ID,
  childMarket,
  childToken,
  DOWN,
  INVALID,
  LIST,
  OPTIONS,
  OTHER_OWNER,
  OWNER,
  PARENT,
  parentToken,
  resolvedParent,
  SCOPE,
  tradeWalletOf,
  TWO_WINNERS,
  unresolvedChild,
  UP,
  valuedChild,
  WAD,
} from "../../redeem/__tests__/support/session";
import { redeemBatchDepartures } from "../../redeem/tradeWalletBatchAllowed";
import { fetchSessionResolution, type SessionResolution } from "../getSessionResolution";
import { fetchRedeemScope, fetchTradeWalletRedeem, readTradeWalletRedeem } from "../getTradeWalletRedeem";

vi.mock("../getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));

/** Gnosis' sDAI, written out so a wrong address in config or the fetcher shows. */
const GNOSIS_SDAI: Address = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
const FACTORY: Address = "0x5f00000000000000000000000000000000000000";
const REQUEST = { chainId: CHAIN_ID, owner: OWNER, sessionFactory: FACTORY, sessionId: 7n };

const REDEEM_ABI = parseAbi([
  "function redeemPositions(address,address,uint256[],uint256[])",
  "function redeemConditionalToCollateral(address,address,uint256[],uint256[],uint256[])",
]);

interface Call {
  address: Address;
  functionName: string;
  args?: readonly unknown[];
}

/** The chain as the fetcher reads it: the session, each market's wrapped tokens, and balances per holder. */
function fakeClient(balances: { holder: Address; token: Address; balance: bigint }[]) {
  const balanceReads: Call[] = [];
  const answer = ({ address, functionName, args }: Call): unknown => {
    if (functionName === "getSession") {
      if (!isAddressEqual(address, FACTORY) || args?.[0] !== 7n) throw new Error("unknown session");
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
      balanceReads.push({ address, functionName, args });
      const holder = args![0] as Address;
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
  return { client, balanceReads };
}

const held = (token: Address, balance: bigint) => ({ holder: tradeWalletOf(OWNER), token, balance });

function decoded(tx: { data?: `0x${string}` }) {
  const outer = decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data! });
  if (outer.functionName !== "batchExecute") throw new Error(outer.functionName);
  return outer.args[0].map(({ to, data }) =>
    data.startsWith("0x095ea7b3")
      ? { to, kind: "approve" as const, args: decodeFunctionData({ abi: erc20Abi, data }).args as readonly unknown[] }
      : { to, kind: "redeem" as const, ...decodeFunctionData({ abi: REDEEM_ABI, data }) },
  );
}

const resolve = (resolution: SessionResolution) => vi.mocked(fetchSessionResolution).mockResolvedValue(resolution);

beforeEach(() => {
  vi.mocked(fetchSessionResolution).mockReset();
});

describe("reading a trade wallet redeem on-chain", () => {
  it("reads each market's tokens from wrappedOutcome, with the chain's sDAI as collateral", async () => {
    const { client } = fakeClient([]);
    const scope = await fetchRedeemScope(client, REQUEST);

    expect(isAddressEqual(scope.collateral, GNOSIS_SDAI)).toBe(true);
    expect(scope.parentMarket).toBe(PARENT);
    expect(scope.parentTokens).toEqual([0, 1, 2, 3].map(parentToken));
    for (const option of [0, 1, 2]) {
      expect(scope.children[option]).toEqual({
        market: childMarket(option),
        tokens: [DOWN, UP, INVALID].map((slot) => childToken(option, slot)),
      });
    }
  });

  it("plans a parent INVALID balance when the parent resolved INVALID", async () => {
    resolve({ parent: resolvedParent([0n, 0n, 0n, 1n]), children: TWO_WINNERS.children });
    const { client } = fakeClient([held(parentToken(0), WAD), held(parentToken(3), 9n * WAD - 5n)]);

    const plan = await fetchTradeWalletRedeem(client, REQUEST);
    const redeems = decoded(plan.tx!).filter((call) => call.kind === "redeem");

    expect(plan.payout).toBe(9n * WAD - 5n);
    expect(redeems).toHaveLength(1);
    expect(redeems[0]!.args).toEqual([GNOSIS_SDAI, PARENT, [3n], [9n * WAD - 5n]]);
  });

  it("reads the balances of the owner's own trade wallet, not the owner or another trade wallet", async () => {
    resolve(TWO_WINNERS);
    const { client, balanceReads } = fakeClient([
      { holder: OWNER, token: parentToken(0), balance: WAD },
      { holder: tradeWalletOf(OTHER_OWNER), token: parentToken(1), balance: WAD },
    ]);

    const plan = await fetchTradeWalletRedeem(client, REQUEST);

    expect(plan.tx).toBeNull();
    expect(balanceReads.length).toBe(4 + 3 * OPTIONS);
    for (const read of balanceReads) expect(read.args).toEqual([tradeWalletOf(OWNER)]);
  });

  it("redeems each child's own tokens through its own market and parent outcome, in sDAI", async () => {
    resolve(TWO_WINNERS);
    const { client } = fakeClient([
      held(childToken(0, UP), 2n * WAD),
      held(childToken(1, DOWN), 3n * WAD),
      held(childToken(1, UP), 5n * WAD),
    ]);

    const { plan, scope } = await readTradeWalletRedeem(client, REQUEST);
    const calls = decoded(plan.tx!);

    expect(calls.map((call) => call.kind)).toEqual(["approve", "redeem", "approve", "approve", "redeem"]);
    expect(calls[0]).toMatchObject({ to: childToken(0, UP), args: [LIST.conditionalRouter, 2n * WAD] });
    expect(calls[1]).toMatchObject({ args: [GNOSIS_SDAI, childMarket(0), [1n], [0n], [2n * WAD]] });
    expect(calls[2]).toMatchObject({ to: childToken(1, UP), args: [LIST.conditionalRouter, 5n * WAD] });
    expect(calls[3]).toMatchObject({ to: childToken(1, DOWN), args: [LIST.conditionalRouter, 3n * WAD] });
    expect(calls[4]).toMatchObject({ args: [GNOSIS_SDAI, childMarket(1), [1n, 0n], [1n], [5n * WAD, 3n * WAD]] });
    expect(redeemBatchDepartures({ tx: plan.tx!, chainId: CHAIN_ID, account: OWNER, scope })).toEqual([]);
  });

  it("lists a held winner whose child has not resolved as waiting", async () => {
    resolve({ ...TWO_WINNERS, children: { 0: valuedChild(0, 42n), 1: unresolvedChild(1), 2: unresolvedChild(2) } });
    const { client } = fakeClient([held(childToken(1, INVALID), 1n), held(childToken(2, UP), WAD)]);

    expect((await fetchTradeWalletRedeem(client, REQUEST)).waiting).toEqual([1]);
  });

  it("rejects when a read fails, so nothing is offered", async () => {
    resolve(TWO_WINNERS);
    const { client } = fakeClient([]);
    await expect(fetchTradeWalletRedeem(client, { ...REQUEST, sessionId: 8n })).rejects.toThrow("unknown session");
  });
});

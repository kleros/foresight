import { print } from "graphql";
import type { Address, PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { gnosisRouterAddress } from "@/config/contracts";

import {
  CHAIN_ID,
  childToken,
  OWNER,
  parentToken,
  SCOPE,
  SDAI,
  tradeWalletOf,
  TWO_WINNERS,
  UP,
} from "../../redeem/__tests__/support/session";
import { fetchRealisedPnl } from "../getRealisedPnl";
import { fetchSessionResolution } from "../getSessionResolution";
import { fetchRedeemScope } from "../getTradeWalletRedeem";

vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
vi.mock("../getSessionResolution", () => ({ fetchSessionResolution: vi.fn() }));
vi.mock("../getTradeWalletRedeem", () => ({ fetchRedeemScope: vi.fn() }));

const FACTORY: Address = "0x5f00000000000000000000000000000000000000";
const REQUEST = { chainId: CHAIN_ID, owner: OWNER, sessionFactory: FACTORY, sessionId: 7n };
const WALLET = tradeWalletOf(OWNER).toLowerCase();
const lower = (address: Address) => address.toLowerCase();

describe("fetchRealisedPnl", () => {
  it("reads the trade wallet's P&L from its indexed redeems, splits and balances", async () => {
    vi.mocked(fetchRedeemScope).mockResolvedValue(SCOPE);
    vi.mocked(fetchSessionResolution).mockResolvedValue(TWO_WINNERS);
    // split 600 into tx 0xb1; redeemed option 0's 100 parent tokens for 50 in tx 0xa1; holds option 0's 100 UP
    // and option 1's 100 parent tokens
    vi.mocked(fetchGraphql).mockResolvedValue({
      Redeem: [
        { account: WALLET, childMarket_id: null, parentOutcomeIndex: "0", payout: "50", transactionHash: "0xa1" },
      ],
      accountRedeems: [
        { account: WALLET, childMarket_id: null, parentOutcomeIndex: "0", payout: "50", transactionHash: "0xa1" },
      ],
      Transfer: [
        { transactionHash: "0xb1", token: lower(SDAI), amount: "-600" },
        ...SCOPE.parentTokens.map((token) => ({ transactionHash: "0xb1", token: lower(token), amount: "600" })),
        { transactionHash: "0xa1", token: lower(parentToken(0)), amount: "-100" },
        { transactionHash: "0xa1", token: lower(SDAI), amount: "50" },
      ],
      Position: [
        { token: lower(parentToken(0)), balance: "0" },
        { token: lower(parentToken(1)), balance: "100" },
        { token: lower(childToken(0, UP)), balance: "100" },
      ],
    });

    const result = await fetchRealisedPnl({} as PublicClient, REQUEST);

    // option 0: 50 redeemed, and 100 UP at 0.42 pay 42 parent tokens, 21 at half the parent
    expect(result.options).toEqual({
      0: { status: "settled", cost: 200n, payout: 71n, pnl: -129n },
      1: { status: "settled", cost: 200n, payout: 50n, pnl: -150n },
      2: { status: "settled", cost: 200n, payout: 0n, pnl: -200n },
    });
    expect(result.session).toEqual({ cost: 600n, payout: 121n, pnl: -479n, waiting: [] });

    const [document, variables] = vi.mocked(fetchGraphql).mock.calls[0]!;
    const query = print(document);
    expect(query).toContain("Redeem(where: {session_id: {_eq: $sessionId}, account: {_eq: $account}})");
    expect(query).toContain(
      "Transfer(\n    where: {executor_id: {_eq: $account}, token: {_in: $tokens}, counterparty: {_in: $routers}}\n  )",
    );
    expect(variables).toMatchObject({
      sessionId: "7",
      account: WALLET,
      routers: [lower(gnosisRouterAddress(CHAIN_ID)!)],
    });
    expect(variables?.tokens).toEqual(
      [SDAI, ...SCOPE.parentTokens, ...Object.values(SCOPE.children).flatMap((child) => child!.tokens)].map(lower),
    );
  });
  it("adds back a parent redeem's payout that its rows split with another session sharing the tokens", async () => {
    vi.mocked(fetchRedeemScope).mockResolvedValue(SCOPE);
    vi.mocked(fetchSessionResolution).mockResolvedValue(TWO_WINNERS);
    const split = [
      { transactionHash: "0xb1", token: lower(SDAI), amount: "-600" },
      ...SCOPE.parentTokens.map((token) => ({ transactionHash: "0xb1", token: lower(token), amount: "600" })),
    ];
    const row = (payout: string) => ({
      account: WALLET,
      childMarket_id: null,
      parentOutcomeIndex: "0",
      payout,
      transactionHash: "0xa1",
    });
    // one 400 sDAI payout for option 0's parent tokens, 100 of it this session's and 300 another's
    const [mine, theirs] = [row("100"), row("300")];
    const read = async (redeemed: boolean) => {
      vi.mocked(fetchGraphql).mockResolvedValueOnce({
        Redeem: redeemed ? [mine] : [],
        accountRedeems: redeemed ? [mine, theirs] : [],
        Transfer: redeemed
          ? [
              ...split,
              { transactionHash: "0xa1", token: lower(parentToken(0)), amount: "-400" },
              { transactionHash: "0xa1", token: lower(SDAI), amount: "400" },
            ]
          : split,
        Position: [],
      });
      return (await fetchRealisedPnl({} as PublicClient, REQUEST)).options;
    };

    const costs = (options: Awaited<ReturnType<typeof read>>) => Object.values(options).map((option) => option.cost);
    expect(costs(await read(true))).toEqual([200n, 200n, 200n]);
    expect(costs(await read(true))).toEqual(costs(await read(false)));
  });
});

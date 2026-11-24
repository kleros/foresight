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
  resolvedParent,
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
      parentMoves: [],
      Prediction: [],
      ParentOutcomeToken: SCOPE.parentTokens.map((token) => ({ token: lower(token), session_id: "7" })),
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
    expect(query).toContain(
      "parentMoves: Transfer(\n    where: {executor_id: {_eq: $account}, token: {_in: $parentTokens}}\n  )",
    );
    expect(query).toContain(
      "Prediction(\n    where: {executor_id: {_eq: $account}, childMarket: {underlyingToken: {_in: $parentTokens}}}\n  )",
    );
    expect(query).toContain("ParentOutcomeToken(where: {token: {_in: $parentTokens}})");
    expect(variables).toMatchObject({
      sessionId: "7",
      account: WALLET,
      parentTokens: SCOPE.parentTokens.map(lower),
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
        parentMoves: [],
        Prediction: [],
        ParentOutcomeToken: [],
        Position: [],
      });
      return (await fetchRealisedPnl({} as PublicClient, REQUEST)).options;
    };

    const costs = (options: Awaited<ReturnType<typeof read>>) => Object.values(options).map((option) => option.cost);
    expect(costs(await read(true))).toEqual([200n, 200n, 200n]);
    expect(costs(await read(true))).toEqual(costs(await read(false)));
  });
});

/** Sessions 7 and 8 ask the same parent question, so their trade wallet holds one balance of each parent token. */
describe("fetchRealisedPnl with parent tokens another session shares", () => {
  const ROUTER = lower(gnosisRouterAddress(CHAIN_ID)!);
  const POOL = "0x9000000000000000000000000000000000000000";
  const OPTION_0_WINS = { parent: resolvedParent([1n, 0n, 0n, 0n]), children: {} };

  interface Leg {
    token: Address;
    amount: bigint;
    counterparty: string;
  }
  interface Tx {
    hash: string;
    /** The session a prediction in this transaction belongs to; none for a merge or a redeem. */
    session?: string;
    legs: Leg[];
  }

  /** Splits `deposit` sDAI into every parent token and sends `spent` of option 0's to a pool. */
  const prediction = (hash: string, session: string, deposit: bigint, spent: bigint): Tx => ({
    hash,
    session,
    legs: [
      { token: SDAI, amount: -deposit, counterparty: ROUTER },
      ...SCOPE.parentTokens.map((token) => ({ token, amount: deposit, counterparty: ROUTER })),
      { token: parentToken(0), amount: -spent, counterparty: POOL },
    ],
  });
  /** Sends `amounts` of the parent tokens to Seer's router for `paid` sDAI. */
  const toRouter = (hash: string, amounts: bigint[], paid: bigint): Tx => ({
    hash,
    legs: [
      ...amounts.flatMap((amount, index) =>
        amount === 0n ? [] : [{ token: parentToken(index), amount: -amount, counterparty: ROUTER }],
      ),
      { token: SDAI, amount: paid, counterparty: ROUTER },
    ],
  });
  const redeemed = (session: string, option: number, payout: bigint) => ({
    session,
    row: {
      account: WALLET,
      childMarket_id: null,
      parentOutcomeIndex: String(option),
      payout: String(payout),
      transactionHash: "0xa1",
    },
  });

  /** The rows the indexer holds for the trade wallet after `txs`, in order, as session `sessionId` reads them. */
  function rows(sessionId: string, txs: Tx[], redeems: ReturnType<typeof redeemed>[] = []) {
    const legs = txs.flatMap((tx, block) =>
      tx.legs.map((leg, logIndex) => ({ ...leg, hash: tx.hash, block, logIndex, token: lower(leg.token) })),
    );
    const parents = new Set(SCOPE.parentTokens.map(lower));
    const balances = new Map<string, bigint>();
    for (const leg of legs) balances.set(leg.token, (balances.get(leg.token) ?? 0n) + leg.amount);
    return {
      Redeem: redeems.filter((each) => each.session === sessionId).map((each) => each.row),
      accountRedeems: redeems.map((each) => each.row),
      Transfer: legs
        .filter((leg) => leg.counterparty === ROUTER)
        .map((leg) => ({ transactionHash: leg.hash, token: leg.token, amount: String(leg.amount) })),
      parentMoves: legs
        .filter((leg) => parents.has(leg.token))
        .map((leg) => ({
          transactionHash: leg.hash,
          token: leg.token,
          amount: String(leg.amount),
          blockNumber: String(leg.block),
          logIndex: leg.logIndex,
        })),
      Prediction: txs.flatMap((tx) =>
        tx.session === undefined ? [] : [{ transactionHash: tx.hash, childMarket: { session_id: tx.session } }],
      ),
      ParentOutcomeToken: SCOPE.parentTokens.flatMap((token) =>
        ["7", "8"].map((session_id) => ({ token: lower(token), session_id })),
      ),
      Position: [...balances].map(([token, balance]) => ({ token, balance: String(balance) })),
    };
  }

  const read = async (sessionId: bigint, indexed: ReturnType<typeof rows>, resolution = OPTION_0_WINS) => {
    vi.mocked(fetchRedeemScope).mockResolvedValue(SCOPE);
    vi.mocked(fetchSessionResolution).mockResolvedValue(resolution);
    vi.mocked(fetchGraphql).mockResolvedValueOnce(indexed);
    return fetchRealisedPnl({} as PublicClient, { ...REQUEST, sessionId });
  };
  const settled = (cost: bigint, payout: bigint) => ({ status: "settled", cost, payout, pnl: payout - cost });

  it("charges each session its own split and reads the same figure after a redeem filed under both", async () => {
    const trades = [prediction("0xb1", "7", 200n, 0n), prediction("0xb2", "8", 200n, 0n)];
    const before = rows("7", trades);
    const after = rows(
      "7",
      [...trades, toRouter("0xa1", [400n], 400n)],
      [redeemed("7", 0, 200n), redeemed("8", 0, 200n)],
    );

    const expected = {
      options: { 0: settled(66n, 200n), 1: settled(67n, 0n), 2: settled(67n, 0n) },
      session: { cost: 200n, payout: 200n, pnl: 0n, waiting: [] },
    };
    expect(await read(7n, before)).toEqual(expected);
    expect(await read(7n, after)).toEqual(expected);
  });

  it("weighs a shared balance by each session's net holdings, before and after the redeem", async () => {
    const twoWinners = { parent: resolvedParent([1n, 1n, 0n, 0n]), children: {} };
    const trades = [prediction("0xb1", "7", 400n, 100n), prediction("0xb2", "8", 150n, 50n)];
    // 400 of option 0 and 550 of option 1 pay 200 and 275; 7 holds 300 and 400 of them, 8 holds 100 and 150
    const redeem = toRouter("0xa1", [400n, 550n], 475n);
    const filed = [redeemed("7", 0, 150n), redeemed("7", 1, 200n), redeemed("8", 0, 50n), redeemed("8", 1, 75n)];

    const expected = {
      options: { 0: settled(133n, 150n), 1: settled(133n, 200n), 2: settled(134n, 0n) },
      session: { cost: 400n, payout: 350n, pnl: -50n, waiting: [] },
    };
    expect(await read(7n, rows("7", trades), twoWinners)).toEqual(expected);
    expect(await read(7n, rows("7", [...trades, redeem], filed), twoWinners)).toEqual(expected);
  });

  it("credits a merge to the session whose tokens it took, so a later redeem reads the same", async () => {
    const trades = [
      prediction("0xb1", "7", 400n, 100n),
      toRouter("0xc1", [300n, 300n, 300n, 300n], 300n),
      prediction("0xb2", "8", 150n, 50n),
    ];
    const redeem = toRouter("0xa1", [100n], 100n);
    const filed = [redeemed("8", 0, 100n)];

    const merged = {
      options: { 0: settled(33n, 0n), 1: settled(33n, 0n), 2: settled(34n, 0n) },
      session: { cost: 100n, payout: 0n, pnl: -100n, waiting: [] },
    };
    const holding = {
      options: { 0: settled(50n, 100n), 1: settled(50n, 0n), 2: settled(50n, 0n) },
      session: { cost: 150n, payout: 100n, pnl: -50n, waiting: [] },
    };
    expect(await read(7n, rows("7", trades))).toEqual(merged);
    expect(await read(7n, rows("7", [...trades, redeem], filed))).toEqual(merged);
    expect(await read(8n, rows("8", trades))).toEqual(holding);
    expect(await read(8n, rows("8", [...trades, redeem], filed))).toEqual(holding);
  });
});

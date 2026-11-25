import type { DocumentNode } from "graphql";
import type { Address, PublicClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { executorAddress } from "@/lib/trade-executor/executor";

import { tradeExecutorFactoryAddress } from "@/config/contracts";

import { createFakeIndexer, type Tables } from "@/testing/fakeIndexer";

import { fetchRealisedPnl } from "../getRealisedPnl";
import { fetchSessionResolution, type SessionResolution } from "../getSessionResolution";
import { fetchRedeemScope } from "../getTradeWalletRedeem";

vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
vi.mock("../getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));
vi.mock("../getTradeWalletRedeem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../getTradeWalletRedeem")>()),
  fetchRedeemScope: vi.fn(),
}));

/**
 * The web read against an in-memory indexer that runs the query it sends, so the session and account it scopes the
 * ledger and redeem rows to are what is tested. Sessions 7 and 8 ask the same question and share tokens.
 */

const CHAIN_ID = 100;
const OWNER: Address = "0x0000000000000000000000000000000000000e01";
const TRADE_WALLET = executorAddress(tradeExecutorFactoryAddress(CHAIN_ID)!, OWNER).toLowerCase();
const STRANGER = "0x00000000000000000000000000000000000000f1";
const REQUEST = {
  chainId: CHAIN_ID,
  owner: OWNER,
  sessionFactory: "0x5f00000000000000000000000000000000000000" as Address,
  sessionId: 7n,
};

const token = (n: number): Address => `0x${n.toString(16).padStart(40, "0")}`;
const [O0, O1, INVALID] = [token(0xa0), token(0xa1), token(0xa2)];
const CHILD_0 = { market: token(0xc0), tokens: [token(0xd0), token(0xd1), token(0xd2)] };
const CHILD_1 = { market: token(0xc1), tokens: [token(0xe0), token(0xe1), token(0xe2)] };
const [DOWN_0, UP_0] = CHILD_0.tokens as [Address, Address, Address];

const RESOLUTION: SessionResolution = {
  parent: {
    resolved: true,
    invalid: false,
    winningOutcomes: [0],
    payoutNumerators: [1n, 0n, 0n],
    payoutDenominator: 1n,
  },
  children: {
    0: {
      deployed: true,
      market: CHILD_0.market,
      resolved: true,
      invalid: false,
      finalValue: 70,
      payoutNumerators: [3n, 7n, 0n],
      payoutDenominator: 10n,
    },
    1: { deployed: true, market: CHILD_1.market, resolved: false },
  },
};

let id = 0;
const move = (
  session: string,
  moved: Address,
  amount: bigint,
  extra: { cost?: bigint; tx?: string; account?: string } = {},
) => ({
  id: String(id++),
  account: extra.account ?? TRADE_WALLET,
  session_id: session,
  token: moved.toLowerCase(),
  amount: String(amount),
  cost: String(extra.cost ?? 0n),
  shared: false,
  redeemed: false,
  logIndex: id,
  blockNumber: "1",
  transactionHash: extra.tx ?? "0xb1",
});
const redeem = (
  session: string,
  option: number,
  payout: bigint,
  childMarket: Address | null,
  account = TRADE_WALLET,
) => ({
  id: String(id++),
  account,
  session_id: session,
  childMarket_id: childMarket?.toLowerCase() ?? null,
  parentOutcomeIndex: String(option),
  payout: String(payout),
  blockNumber: "2",
  timestamp: "2",
  transactionHash: "0xa1",
});

/**
 * Session 7: one split of 300 sDAI, 200 sets minted at option 0's child, its 200 DOWN sold for 60 parent tokens. The
 * trade wallet keeps 160 of option 0's parent token, 300 of option 1's and INVALID, 200 UP and 200 of the child's
 * INVALID.
 */
const predicted = () => [
  move("7", O0, 300n),
  move("7", O1, 300n),
  move("7", INVALID, 300n, { cost: 300n }),
  move("7", O0, -200n),
  ...CHILD_0.tokens.map((each) => move("7", each, 200n)),
  move("7", DOWN_0, -200n, { tx: "0xb2" }),
  move("7", O0, 60n, { tx: "0xb2" }),
];

/** Rows of the same tokens the read must leave out: session 8's, and a stranger's in session 7. */
const elsewhere = () => [
  move("8", O0, 1_000n, { cost: 0n }),
  move("8", INVALID, 1_000n, { cost: 1_000n, tx: "0xc1" }),
  move("8", UP_0, 500n),
  move("7", O0, 700n, { account: STRANGER }),
  move("7", INVALID, 700n, { cost: 700n, account: STRANGER, tx: "0xd1" }),
];
const elsewhereRedeems = () => [redeem("8", 0, 999n, null), redeem("7", 0, 555n, null, STRANGER)];

/** Every response the indexer gave since the last serve(), as the web read received it. */
let responses: unknown[] = [];

function serve(tables: Tables) {
  const fake = createFakeIndexer(tables);
  responses = [];
  vi.mocked(fetchGraphql).mockImplementation((async (document: DocumentNode, variables?: Record<string, unknown>) => {
    const response = await fake.answer(document, variables);
    responses.push(response);
    return response;
  }) as typeof fetchGraphql);
}

const read = (sessionId = 7n) => fetchRealisedPnl({} as PublicClient, { ...REQUEST, sessionId });

beforeEach(() => {
  vi.mocked(fetchSessionResolution).mockResolvedValue(RESOLUTION);
  vi.mocked(fetchRedeemScope).mockResolvedValue({
    collateral: token(0x5da1),
    parentMarket: token(0xb0),
    parentTokens: [O0, O1, INVALID],
    children: { 0: CHILD_0, 1: CHILD_1 },
  });
});

describe("fetchRealisedPnl", () => {
  it("reads the trade wallet's own rows in this session and values them at the resolution", async () => {
    serve({ SessionMove: [...predicted(), ...elsewhere()], Redeem: elsewhereRedeems() });

    const result = await read();

    // option 0: 160 parent tokens pay 160, 200 UP at 0.7 pay 140
    expect(result.options[0]).toEqual({ status: "settled", cost: 150n, payout: 300n, pnl: 150n });
    expect(result.options[1]).toEqual({ status: "settled", cost: 150n, payout: 0n, pnl: -150n });
    expect(result.session).toEqual({ cost: 300n, payout: 300n, pnl: 0n, waiting: [] });
  });

  it("asks the indexer for this trade wallet's redeems only", async () => {
    serve({ SessionMove: predicted(), Redeem: [...elsewhereRedeems(), redeem("7", 0, 160n, null)] });

    await read();

    const rows = responses.flatMap((response) => (response as { Redeem?: { account: string }[] }).Redeem ?? []);
    expect(rows).toHaveLength(1);
    expect(rows.every((row) => row.account === TRADE_WALLET)).toBe(true);
  });

  it("reads the same after the redeem, from the payouts indexed for this session", async () => {
    serve({ SessionMove: [...predicted(), ...elsewhere()], Redeem: elsewhereRedeems() });
    const before = await read();

    serve({
      SessionMove: [
        ...predicted(),
        ...elsewhere(),
        move("7", O0, -160n, { tx: "0xa1" }),
        move("7", UP_0, -200n, { tx: "0xa1" }),
      ],
      Redeem: [...elsewhereRedeems(), redeem("7", 0, 160n, null), redeem("7", 0, 140n, CHILD_0.market)],
    });
    const after = await read();

    expect(after).toEqual(before);
  });

  it("reads an option whose market resolved INVALID at its INVALID payout less cost", async () => {
    vi.mocked(fetchSessionResolution).mockResolvedValue({
      ...RESOLUTION,
      children: {
        ...RESOLUTION.children,
        0: {
          deployed: true,
          market: CHILD_0.market,
          resolved: true,
          invalid: true,
          finalValue: null,
          payoutNumerators: [0n, 0n, 1n],
          payoutDenominator: 1n,
        },
      },
    });
    serve({ SessionMove: [...predicted(), ...elsewhere()], Redeem: elsewhereRedeems() });

    const result = await read();

    // 160 parent tokens pay 160, the child's 200 INVALID pay 200, UP pays nothing
    expect(result.options[0]).toEqual({ status: "settled", cost: 150n, payout: 360n, pnl: 210n });
  });

  it("reads nothing for a session sharing the tokens that this trade wallet never held through", async () => {
    serve({ SessionMove: predicted(), Redeem: [redeem("7", 0, 160n, null)] });

    const result = await read(8n);

    expect(result.session).toEqual({ cost: 0n, payout: 0n, pnl: 0n, waiting: [] });
    expect(Object.values(result.options).every((each) => each.status === "settled" && each.payout === 0n)).toBe(true);
  });

  it("charges both splits of a batch that credits and sDAI fund", async () => {
    serve({
      SessionMove: [
        ...predicted(),
        // the credits' xDAI split, then the sDAI split, in one transaction
        ...[50n, 120n].flatMap((amount) => [
          move("7", O0, amount, { tx: "0xf1" }),
          move("7", O1, amount, { tx: "0xf1" }),
          move("7", INVALID, amount, { cost: amount, tx: "0xf1" }),
        ]),
      ],
      Redeem: [],
    });

    const result = await read();

    expect(result.session.cost).toBe(470n);
  });

  it("charges each split once, a merge's negative cost included", async () => {
    serve({
      SessionMove: [
        ...predicted(),
        move("7", O0, -100n, { tx: "0xe1" }),
        move("7", O1, -100n, { tx: "0xe1" }),
        move("7", INVALID, -100n, { cost: -100n, tx: "0xe1" }),
      ],
      Redeem: [],
    });

    const result = await read();

    expect(result.session.cost).toBe(200n);
  });
});

import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeIndexer, type Tables } from "@/features/sessions/api/__tests__/support/fakeIndexer";
import {
  OPTIONS,
  SESSION_ID,
  type Option,
  addressSuffix,
  amountPattern,
  baseTables,
  executorRow,
  indexerAnswers,
  predictionRow,
  sessionDetailAnswer,
  traderAddress,
  txHash,
  wei,
} from "@/features/sessions/api/__tests__/support/tradeHistoryFixtures";
import { refreshSessionAfterTrade } from "@/features/sessions/api/getSessionStats";
import { fundsKeyPrefix } from "@/features/trade-executor/api/getFunds";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";

/**
 * Acceptance tests for the market page's My trades tab (issue 2026-10-30-foresight-my-trades-pnl,
 * A1, A2 and A7, and the copy of A5 and A6), through the whole page against a fake indexer.
 *
 * What the page is held to, beyond the issue's copy:
 * - "My trades" is a `tab` beside All trades, and its content is the one shown `tabpanel`;
 * - the connected account is the owner of a trade wallet whose address differs from its own; the
 *   wallet's balances answer the same whether read on-chain or from the indexer's `Position` rows;
 * - with one outcome in the decision (the fixtures' 1/N rule), underlying and collateral amounts read the same.
 */

const state = vi.hoisted(() => ({
  account: undefined as { address: `0x${string}`; chainId: number } | undefined,
  tradeWallet: null as `0x${string}` | null,
  executor: "ready" as "ready" | "pending" | "error",
  tables: undefined as { Position?: Record<string, unknown>[] } | undefined,
}));

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/features/sessions/api/verifySession", () => ({
  verifySession: async (_client: unknown, _chain: number, row: unknown) => row,
}));
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
/* The factory cannot reference imports, so GATEWAY's value is restated. */
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://cdn.example.link/ipfs" }));
/* The wallet reaches wagmi and the RPC config, neither of which this page's tests supply. */
vi.mock("@/features/trade-executor/components/TradeWallet/TradeWallet", () => ({ TradeWallet: () => null }));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () =>
    state.account
      ? { ...state.account, isConnected: true, status: "connected" }
      : { address: undefined, chainId: undefined, isConnected: false, status: "disconnected" },
}));
vi.mock("@/features/trade-executor/api/getExecutor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/trade-executor/api/getExecutor")>()),
  useExecutor: () =>
    !state.account || state.executor === "pending"
      ? { data: undefined, isPending: true, isError: false, isSuccess: false }
      : state.executor === "error"
        ? { data: undefined, isPending: false, isError: true, isSuccess: false }
        : {
            data: { predicted: state.tradeWallet, deployed: state.tradeWallet },
            isPending: false,
            isError: false,
            isSuccess: true,
          },
}));
/* On-chain balances answer from the same Position rows the fake indexer serves. */
vi.mock("@/lib/trade-executor/balances", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/trade-executor/balances")>()),
  fetchTokenBalances: async (_client: unknown, args: { holder: string; tokens: string[] }) =>
    args.tokens.map((token) => {
      const row = (state.tables?.Position ?? []).find(
        (each) => each.executor_id === args.holder.toLowerCase() && each.token === token.toLowerCase(),
      );
      return row ? BigInt(row.balance as string) : 0n;
    }),
}));

const fetchMock = vi.mocked(fetchGraphql);
const { gerwig: GERWIG, villeneuve: VILLENEUVE } = OPTIONS;

/** A minute ago, so every fixture trade is in the past. */
const NOW = Math.floor(Date.now() / 1000) - 60;

/** The connected account and its trade wallet, at different addresses. */
const ME = "0x0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0eb0b1" as Address;
const MY_WALLET = traderAddress(0);
/** Another account's trade wallet, trading the same session. */
const THEM = "0x0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0fc0c2";
const THEIR_WALLET = traderAddress(1);

const wallets = () => [
  { ...executorRow(MY_WALLET), owner: ME.toLowerCase() },
  { ...executorRow(THEIR_WALLET), owner: THEM },
];

const position = (wallet: string, token: string, amount: string) => ({
  id: `${wallet}-${token}`,
  executor_id: wallet,
  token,
  balance: wei(amount),
  updatedAt: String(NOW),
});

/** An outright buy of one side, every column the indexer would set for it. */
function buy(args: {
  tx: number;
  wallet: string;
  option: Option;
  side: "UP" | "DOWN";
  tokens: string;
  paid: string;
  at: number;
}) {
  const side = args.side === "UP" ? "up" : "down";
  return predictionRow({
    tx: txHash(args.tx),
    executor: args.wallet,
    option: args.option,
    timestamp: args.at,
    columns: {
      underlyingDelta: `-${wei(args.paid)}`,
      [`${side}Delta`]: wei(args.tokens),
      [`${side}Balance`]: wei(args.tokens),
      [`${side}SwapUnderlying`]: `-${wei(args.paid)}`,
      [`${side}SwapTokens`]: wei(args.tokens),
      [`${side}AvgPrice`]: wei((Number(args.paid) / Number(args.tokens)).toFixed(6)),
    },
  });
}

/**
 * Two predictions of mine and two of theirs. At the fixtures' spot (UP 0.3, DOWN 0.7):
 * Gerwig 10 UP paid 2.63, worth 3, +0.37; Villeneuve 10 DOWN paid 5.78, worth 7, +1.22; total +1.59.
 */
const MY_GERWIG = {
  tx: 1,
  wallet: MY_WALLET,
  option: GERWIG,
  side: "UP",
  tokens: "10",
  paid: "2.63",
  at: NOW,
} as const;
const MY_VILLENEUVE = {
  tx: 2,
  wallet: MY_WALLET,
  option: VILLENEUVE,
  side: "DOWN",
  tokens: "10",
  paid: "5.78",
  at: NOW - 60,
} as const;
const THEIR_TRADES = [
  { tx: 3, wallet: THEIR_WALLET, option: GERWIG, side: "DOWN", tokens: "11", paid: "7.77", at: NOW - 120 },
  { tx: 4, wallet: THEIR_WALLET, option: VILLENEUVE, side: "UP", tokens: "12", paid: "4.44", at: NOW - 180 },
] as const;
const THEIR_SIZES = ["7.77", "4.44"];

const theirPositions = () => [
  position(THEIR_WALLET, GERWIG.downToken, "11"),
  position(THEIR_WALLET, VILLENEUVE.upToken, "12"),
];

function traded(): Tables {
  return {
    ...baseTables(),
    Executor: wallets(),
    Prediction: [buy(MY_GERWIG), buy(MY_VILLENEUVE), ...THEIR_TRADES.map(buy)],
    Position: [
      position(MY_WALLET, GERWIG.upToken, "10"),
      position(MY_WALLET, VILLENEUVE.downToken, "10"),
      ...theirPositions(),
    ],
  };
}

const operationName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

/**
 * `outcomeCount` replaces the session's; the query named `failing` rejects, and the one named `hanging`
 * never answers.
 */
function renderPage(tables: Tables, options: { outcomeCount?: string; failing?: string; hanging?: string } = {}) {
  const fake = createFakeIndexer(tables);
  state.tables = tables;
  const answers = indexerAnswers(fake);
  fetchMock.mockImplementation((async (document: DocumentNode, variables?: Record<string, unknown>) => {
    const name = operationName(document);
    if (name === options.failing) throw new Error("The indexer answered 503");
    if (name === options.hanging) return new Promise(() => {});
    if (name === "SessionDetail" && options.outcomeCount) {
      return { Session: [{ ...sessionDetailAnswer.Session[0], outcomeCount: options.outcomeCount }] };
    }
    return answers(document, variables);
  }) as typeof fetchGraphql);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <MarketPage parentMarket={addresses.parentMarket} />
    </QueryClientProvider>
  );
  const view = render(tree());
  return { client, fake, rerender: () => view.rerender(tree()) };
}

const connect = (tradeWallet: string | null = MY_WALLET) => {
  state.account = { address: ME, chainId: DEFAULT_CHAIN_ID };
  state.tradeWallet = tradeWallet as `0x${string}` | null;
};

/** Opens the My trades tab and returns its panel. */
async function openMyTrades(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole("tab", { name: /my trades/i }));
  return screen.findByRole("tabpanel");
}

const textOf = (element: HTMLElement) => element.textContent ?? "";

const SYMBOL = sessionDetailAnswer.Session[0]!.collateralSymbol;

/** The summary's total line: its label and the session's expected P&L. */
const totalOf = (panel: HTMLElement) => within(panel).getByText("Expected P&L").parentElement!;

/** The summary's row for one option. */
const positionRow = (panel: HTMLElement, option: Option) => {
  const summary = within(panel).getByText("Expected P&L").closest("section")!;
  return within(summary).getByText(option.name).closest("li")!;
};

beforeEach(() => {
  fetchMock.mockReset();
  state.account = undefined;
  state.tradeWallet = null;
  state.executor = "ready";
  state.tables = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("My trades without a wallet or without trades (A1)", () => {
  it("asks for a wallet when none is connected", async () => {
    renderPage(traded());

    const panel = await openMyTrades();

    await within(panel).findByText(/Connect a wallet to see your trades/);
    for (const size of ["2.63", "5.78", ...THEIR_SIZES]) expect(textOf(panel)).not.toMatch(amountPattern(size));
  });

  it("shows an empty state, not the connect prompt, for a connected wallet whose trade wallet has not traded", async () => {
    connect();
    renderPage({
      ...baseTables(),
      Executor: wallets(),
      Prediction: THEIR_TRADES.map(buy),
      Position: theirPositions(),
    });

    const panel = await openMyTrades();

    await waitFor(() => expect(textOf(panel).trim()).not.toBe(""));
    expect(textOf(panel)).not.toMatch(/Connect a wallet/i);
    for (const size of THEIR_SIZES) expect(textOf(panel)).not.toMatch(amountPattern(size));
    expect(textOf(panel)).toMatch(/You have not traded in this market yet/);
    expect(textOf(panel)).not.toMatch(/Could not load|Expected P&L/);
  });

  it("shows an empty state for a connected account that has no trade wallet yet", async () => {
    connect(null);
    renderPage({
      ...baseTables(),
      Executor: [{ ...executorRow(THEIR_WALLET), owner: THEM }],
      Prediction: THEIR_TRADES.map(buy),
      Position: theirPositions(),
    });

    const panel = await openMyTrades();

    await waitFor(() => expect(textOf(panel).trim()).not.toBe(""));
    expect(textOf(panel)).not.toMatch(/Connect a wallet/i);
    for (const size of THEIR_SIZES) expect(textOf(panel)).not.toMatch(amountPattern(size));
    expect(textOf(panel)).toMatch(/You have not traded in this market yet/);
    expect(textOf(panel)).not.toMatch(/Could not load|Expected P&L/);
  });
});

describe("My trades while loading or after a failed read", () => {
  it("shows the loading skeleton while the trade wallet's predictions are on their way", async () => {
    connect();
    renderPage(traded(), { hanging: "WalletTrades" });

    const panel = await openMyTrades();

    await waitFor(() => expect(panel.querySelector('[aria-busy="true"]')).not.toBeNull());
    expect(textOf(panel).trim()).toBe("");
  });

  it("says the trades could not load when the trade wallet's predictions fail to load", async () => {
    connect();
    renderPage(traded(), { failing: "WalletTrades" });

    const panel = await openMyTrades();

    await within(panel).findByText(/Could not load your trades/);
  });

  it("says the trades could not load, not that P&L is unavailable, when the pool prices fail to load", async () => {
    connect();
    renderPage(traded(), { failing: "SessionStats" });

    const panel = await openMyTrades();

    await within(panel).findByText(/Could not load your trades/);
    expect(textOf(panel)).not.toMatch(/P&L unavailable/);
  });

  it("says the trades could not load when the account's trade wallet cannot be looked up", async () => {
    connect();
    state.executor = "error";
    renderPage(traded());

    const panel = await openMyTrades();

    await within(panel).findByText(/Could not load your trades/);
  });
});

describe("My trades lists only the connected wallet's predictions (A2)", () => {
  it("shows a row for each of my predictions and none of the other wallet's", async () => {
    connect();
    renderPage(traded());

    const panel = await openMyTrades();

    await waitFor(() => {
      expect(textOf(panel)).toMatch(amountPattern("2.63"));
      expect(textOf(panel)).toMatch(amountPattern("5.78"));
    });
    for (const size of THEIR_SIZES) expect(textOf(panel)).not.toMatch(amountPattern(size));
    expect(within(panel).queryAllByText(new RegExp(addressSuffix(THEM), "i"))).toHaveLength(0);
    expect(within(panel).queryAllByText(new RegExp(addressSuffix(THEIR_WALLET), "i"))).toHaveLength(0);
  });

  it("opens the All trades popup from one of my rows", async () => {
    connect();
    renderPage(traded());
    const panel = await openMyTrades();

    const sized = await within(panel).findAllByText(amountPattern("5.78"));
    const row = sized.map((element) => element.closest("button")).find((button) => button !== null);
    expect(row, "a clickable row sized 5.78").toBeTruthy();
    await userEvent.click(row!);

    const dialog = await screen.findByRole("dialog");
    expect(textOf(dialog)).toContain(VILLENEUVE.name);
  });
});

describe("My trades in this session only (A2)", () => {
  it("leaves out my trade wallet's predictions in the sessions either side of this one", async () => {
    connect();
    const tables = traded();
    const elsewhere = [
      { session: String(Number(SESSION_ID) - 1), market: "0x0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d", paid: "8.88" },
      { session: String(Number(SESSION_ID) + 1), market: "0x0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e", paid: "3.33" },
    ];
    tables.ChildMarket = [
      ...tables.ChildMarket!,
      ...elsewhere.map((each) => ({ ...tables.ChildMarket![0]!, id: each.market, session_id: each.session })),
    ];
    tables.Prediction = [
      ...tables.Prediction!,
      ...elsewhere.map((each, index) =>
        buy({
          tx: 7 + index,
          wallet: MY_WALLET,
          option: { ...GERWIG, id: each.market },
          side: "UP",
          tokens: "10",
          paid: each.paid,
          at: NOW - 30,
        }),
      ),
    ];
    renderPage(tables);

    const panel = await openMyTrades();

    await waitFor(() => expect(textOf(panel)).toMatch(amountPattern("2.63")));
    for (const each of elsewhere) expect(textOf(panel)).not.toMatch(amountPattern(each.paid));
  });
});

describe("My trades position summary", () => {
  it("shows each option's expected P&L and the session total", async () => {
    connect();
    renderPage(traded());

    const panel = await openMyTrades();

    await waitFor(() => {
      expect(textOf(panel)).toMatch(amountPattern("0.37"));
      expect(textOf(panel)).toMatch(amountPattern("1.22"));
      expect(textOf(panel)).toMatch(amountPattern("1.59"));
    });
    expect(textOf(panel)).not.toMatch(/P&L unavailable/);
  });

  it("charges a prediction that split sDAI in its own transaction for what it put in, not the split's credit", async () => {
    connect();
    renderPage({
      ...baseTables(),
      Executor: wallets(),
      Prediction: [
        // the parent split credits 50 Gerwig underlying; buying 10 UP spends 4.37 of it, so the net is +45.63
        predictionRow({
          tx: txHash(1),
          executor: MY_WALLET,
          option: GERWIG,
          timestamp: NOW,
          columns: {
            underlyingDelta: wei("45.63"),
            upDelta: wei("10"),
            upBalance: wei("10"),
            upSwapUnderlying: `-${wei("4.37")}`,
            upSwapTokens: wei("10"),
            upAvgPrice: wei("0.437"),
          },
        }),
      ],
      Position: [position(MY_WALLET, GERWIG.upToken, "10")],
    });

    const panel = await openMyTrades();

    // 10 UP at the fixtures' UP spot of 0.3 is worth 3: 3 - 4.37
    await waitFor(() => expect(textOf(panel)).toMatch(amountPattern("1.37")));
    expect(textOf(panel)).toMatch(amountPattern("4.37"));
    // 3 + 45.63, were the cost the net underlying
    expect(textOf(panel)).not.toMatch(amountPattern("48.63"));
    expect(textOf(panel)).not.toMatch(amountPattern("45.63"));
  });

  it("signs each option's expected P&L and the total, with each one's share of what was paid", async () => {
    connect();
    renderPage(traded());

    const panel = await openMyTrades();

    // Gerwig +0.37 on 2.63 paid: 3700 / 2.63 = 1406.8, floored to 14.06%
    await waitFor(() => expect(textOf(positionRow(panel, GERWIG))).toContain(`~+0.37 ${SYMBOL} (+14.06%)`));
    // Villeneuve +1.22 on 5.78: 21.1%; the total +1.59 on 8.41: 18.9%
    expect(textOf(positionRow(panel, VILLENEUVE))).toContain(`~+1.22 ${SYMBOL} (+21.1%)`);
    expect(textOf(totalOf(panel))).toContain(`~+1.59 ${SYMBOL} (+18.9%)`);
  });

  it("shows a loss with a minus sign and its share of what was paid", async () => {
    connect();
    renderPage({
      ...baseTables(),
      Executor: wallets(),
      Prediction: [buy({ ...MY_GERWIG, paid: "4" })],
      Position: [position(MY_WALLET, GERWIG.upToken, "10")],
    });

    const panel = await openMyTrades();

    // 10 UP at 0.3 is worth 3 against 4 paid: -1, 25% of the cost
    await waitFor(() => expect(textOf(positionRow(panel, GERWIG))).toContain(`~-1 ${SYMBOL} (-25%)`));
  });

  it("converts the expected P&L to collateral at 1/N of the underlying for a decision of N outcomes", async () => {
    connect();
    renderPage(traded(), { outcomeCount: "2" });

    const panel = await openMyTrades();

    // Villeneuve's +1.22 underlying is 0.61 collateral over two outcomes; its share of the cost is unchanged
    await waitFor(() => expect(textOf(positionRow(panel, VILLENEUVE))).toContain(`~+0.61 ${SYMBOL} (+21.1%)`));
  });

  it("shows each held side's tokens, average entry and current price", async () => {
    connect();
    renderPage(traded());

    const panel = await openMyTrades();

    // Gerwig 10 UP bought for 2.63, the UP pool at 0.3; Villeneuve 10 DOWN for 5.78, the DOWN pool at 0.7
    await waitFor(() => expect(textOf(positionRow(panel, GERWIG))).toContain("10 UP · avg entry 0.263 · now 0.3"));
    expect(textOf(positionRow(panel, VILLENEUVE))).toContain("10 DOWN · avg entry 0.578 · now 0.7");
  });

  it("keeps a fully exited option's P&L, with no share of a cost its sells more than repaid", async () => {
    connect();
    renderPage({
      ...baseTables(),
      Executor: wallets(),
      Prediction: [
        buy({ ...MY_GERWIG, paid: "2.6", at: NOW - 60 }),
        // all 10 UP sold for 3.1
        predictionRow({
          tx: txHash(5),
          executor: MY_WALLET,
          option: GERWIG,
          timestamp: NOW,
          columns: {
            underlyingDelta: wei("3.1"),
            upDelta: `-${wei("10")}`,
            upBalance: "0",
            upSwapUnderlying: wei("3.1"),
            upSwapTokens: `-${wei("10")}`,
            upAvgPrice: wei("0.31"),
          },
        }),
      ],
      Position: [position(MY_WALLET, GERWIG.upToken, "0")],
    });

    const panel = await openMyTrades();

    // 2.6 paid, 3.1 returned, nothing held: +0.5 against a cost of -0.5
    await waitFor(() => expect(textOf(positionRow(panel, GERWIG))).toContain(`~+0.5 ${SYMBOL}`));
    expect(textOf(positionRow(panel, GERWIG))).toContain("0 UP · avg entry 0.26 · now 0.3");
    expect(textOf(positionRow(panel, GERWIG))).not.toContain("%");
  });

  it("says the total is unavailable when no option's P&L is available", async () => {
    connect();
    const tables = traded();
    tables.Pool = tables.Pool!.map((pool) => ({ ...pool, underlyingPerOutcome: null }));
    renderPage(tables);

    const panel = await openMyTrades();

    await waitFor(() => expect(textOf(totalOf(panel))).toMatch(/P&L unavailable/));
    expect(textOf(totalOf(panel))).not.toContain(SYMBOL);
  });

  it("marks an option P&L unavailable once tokens arrive by plain transfer, in the row the indexer writes (A5)", async () => {
    connect();
    const tables = traded();
    // 2 Gerwig UP transferred in: the tokens moved, with no swap and no underlying
    tables.Prediction = [
      ...tables.Prediction!,
      predictionRow({
        tx: txHash(5),
        executor: MY_WALLET,
        option: GERWIG,
        timestamp: NOW - 30,
        columns: { upDelta: wei("2"), upBalance: wei("12") },
      }),
    ];
    tables.Position = [
      position(MY_WALLET, GERWIG.upToken, "12"),
      position(MY_WALLET, VILLENEUVE.downToken, "10"),
      ...theirPositions(),
    ];
    renderPage(tables);

    const panel = await openMyTrades();

    await waitFor(() => expect(textOf(positionRow(panel, GERWIG))).toMatch(/P&L unavailable/));
    expect(textOf(panel)).toMatch(/Excludes 1 option/);
    expect(textOf(totalOf(panel))).toMatch(amountPattern("1.22"));
    // 12 UP at 0.3 against 2.63 paid
    expect(textOf(panel)).not.toMatch(amountPattern("0.97"));
  });

  it("marks an option P&L unavailable once tokens leave for the owner's wallet, in the row the indexer writes (A5)", async () => {
    connect();
    const tables = traded();
    // 4 Gerwig UP withdrawn: the tokens moved, with no swap and no underlying
    tables.Prediction = [
      ...tables.Prediction!,
      predictionRow({
        tx: txHash(6),
        executor: MY_WALLET,
        option: GERWIG,
        timestamp: NOW - 30,
        columns: { upDelta: `-${wei("4")}`, upBalance: wei("6") },
      }),
    ];
    tables.Position = [
      position(MY_WALLET, GERWIG.upToken, "6"),
      position(MY_WALLET, VILLENEUVE.downToken, "10"),
      ...theirPositions(),
    ];
    renderPage(tables);

    const panel = await openMyTrades();

    await waitFor(() => expect(textOf(positionRow(panel, GERWIG))).toMatch(/P&L unavailable/));
    expect(textOf(panel)).toMatch(/Excludes 1 option/);
    expect(textOf(totalOf(panel))).toMatch(amountPattern("1.22"));
    // 6 UP at 0.3 against 2.63 paid
    expect(textOf(panel)).not.toMatch(amountPattern("0.83"));
  });

  it("lists an option the wallet holds with no prediction in it as P&L unavailable (A5)", async () => {
    connect();
    const tables = traded();
    // the indexer writes a Prediction for every token it moves, so a balance with none is a gap in its rows
    tables.Prediction = [buy(MY_GERWIG), ...THEIR_TRADES.map(buy)];
    renderPage(tables);

    const panel = await openMyTrades();

    await waitFor(() => expect(textOf(positionRow(panel, VILLENEUVE))).toMatch(/P&L unavailable/));
    expect(textOf(panel)).toMatch(/Excludes 1 option/);
    expect(textOf(totalOf(panel))).toMatch(amountPattern("0.37"));
  });

  it("marks an option holding transferred-in tokens P&L unavailable and says the total excludes it (A5)", async () => {
    connect();
    const tables = traded();
    // the balance holds 2 Gerwig UP more than the predictions net
    tables.Position = [
      position(MY_WALLET, GERWIG.upToken, "12"),
      position(MY_WALLET, VILLENEUVE.downToken, "10"),
      ...theirPositions(),
    ];
    renderPage(tables);

    const panel = await openMyTrades();

    await within(panel).findByText(/P&L unavailable/);
    expect(textOf(panel)).toMatch(/exclud/i);
    expect(textOf(panel)).toMatch(amountPattern("1.22"));
    expect(textOf(panel)).not.toMatch(amountPattern("1.59"));
    // 12 UP at 0.3 against 2.63 paid
    expect(textOf(panel)).not.toMatch(amountPattern("0.97"));
  });

  it("marks an option whose pools have not priced P&L unavailable rather than valuing its tokens at 0 (A6)", async () => {
    connect();
    const tables = traded();
    tables.Pool = tables.Pool!.map((pool) =>
      pool.childMarket_id === VILLENEUVE.id ? { ...pool, underlyingPerOutcome: null } : pool,
    );
    renderPage(tables);

    const panel = await openMyTrades();

    await within(panel).findByText(/P&L unavailable/);
    expect(textOf(panel)).toMatch(/exclud/i);
    expect(textOf(panel)).toMatch(amountPattern("0.37"));
    // the total were Villeneuve's 10 DOWN valued at 0: 0.37 - 5.78
    expect(textOf(panel)).not.toMatch(amountPattern("5.41"));
    expect(textOf(panel)).not.toMatch(amountPattern("1.59"));
  });
});

describe("My trades as the account or tab changes", () => {
  it("asks for a wallet again and closes the open popup once the account disconnects", async () => {
    connect();
    const { rerender } = renderPage(traded());
    const panel = await openMyTrades();
    const sized = await within(panel).findAllByText(amountPattern("5.78"));
    await userEvent.click(sized.map((element) => element.closest("button")).find((button) => button !== null)!);
    await screen.findByRole("dialog");

    state.account = undefined;
    rerender();

    await within(screen.getByRole("tabpanel")).findByText(/Connect a wallet to see your trades/);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows the other account's trades once the connected account switches", async () => {
    connect();
    const { rerender } = renderPage(traded());
    const panel = await openMyTrades();
    await waitFor(() => expect(textOf(panel)).toMatch(amountPattern("2.63")));

    state.account = { address: THEM as Address, chainId: DEFAULT_CHAIN_ID };
    state.tradeWallet = THEIR_WALLET as Address;
    rerender();

    await waitFor(() => {
      for (const size of THEIR_SIZES) expect(textOf(screen.getByRole("tabpanel"))).toMatch(amountPattern(size));
    });
    for (const size of ["2.63", "5.78"]) expect(textOf(screen.getByRole("tabpanel"))).not.toMatch(amountPattern(size));
  });

  it("lists every wallet's trades again once All trades is chosen after My trades", async () => {
    connect();
    renderPage(traded());
    await openMyTrades();

    await userEvent.click(screen.getByRole("tab", { name: /all trades/i }));

    await waitFor(() => {
      for (const size of ["2.63", "5.78", ...THEIR_SIZES]) {
        expect(textOf(screen.getByRole("tabpanel"))).toMatch(amountPattern(size));
      }
    });
  });
});

describe("My trades after the user's prediction is indexed (A7)", () => {
  /** refreshSessionAfterTrade's poll interval and attempts; the run outlasts both. */
  const POLL_MS = 5_000;
  const OUTLAST_POLLING_MS = POLL_MS * 14;

  it("shows the new prediction's option and total once refreshSessionAfterTrade has run", async () => {
    connect();
    const before: Tables = {
      ...baseTables(),
      Executor: wallets(),
      Prediction: [buy(MY_GERWIG), ...THEIR_TRADES.map(buy)],
      Position: [position(MY_WALLET, GERWIG.upToken, "10"), ...theirPositions()],
    };
    const { client, fake } = renderPage(before);
    const panel = await openMyTrades();
    await waitFor(() => expect(textOf(panel)).toMatch(amountPattern("0.37")));
    expect(textOf(panel)).not.toMatch(amountPattern("1.22"));

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const after = traded();
    fake.set("Prediction", after.Prediction!);
    fake.set("Position", after.Position!);
    state.tables = after;
    // the confirmed transaction refreshes on-chain balances before the indexer catches up
    void client.invalidateQueries({ queryKey: fundsKeyPrefix });
    // never awaited: its last invalidation refetches the chart, whose fixture answer never arrives
    void refreshSessionAfterTrade(client, SESSION_ID);
    await vi.advanceTimersByTimeAsync(OUTLAST_POLLING_MS);
    vi.useRealTimers();

    await waitFor(() => {
      expect(textOf(screen.getByRole("tabpanel"))).toMatch(amountPattern("1.22"));
      expect(textOf(screen.getByRole("tabpanel"))).toMatch(amountPattern("1.59"));
    });
  }, 20_000);
});

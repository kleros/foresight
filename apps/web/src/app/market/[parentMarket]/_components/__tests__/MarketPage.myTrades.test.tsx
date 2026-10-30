import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    state.account
      ? { data: { predicted: state.tradeWallet, deployed: state.tradeWallet }, isPending: false, isSuccess: true }
      : { data: undefined, isPending: true, isSuccess: false },
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

function renderPage(tables: Tables) {
  const fake = createFakeIndexer(tables);
  state.tables = tables;
  fetchMock.mockImplementation(indexerAnswers(fake) as typeof fetchGraphql);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MarketPage parentMarket={addresses.parentMarket} />
    </QueryClientProvider>,
  );
  return { client, fake };
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

beforeEach(() => {
  fetchMock.mockReset();
  state.account = undefined;
  state.tradeWallet = null;
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

  it("marks an option holding transferred-in tokens P&L unavailable and says the total excludes it (A5)", async () => {
    connect();
    const tables = traded();
    // the predictions net 10 Gerwig UP; 2 more arrived by plain transfer
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

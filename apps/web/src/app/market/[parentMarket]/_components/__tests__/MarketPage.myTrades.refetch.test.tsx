import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeIndexer, type Tables } from "@/features/sessions/api/__tests__/support/fakeIndexer";
import {
  OPTIONS,
  SESSION_ID,
  type Option,
  amountPattern,
  baseTables,
  executorRow,
  indexerAnswers,
  predictionRow,
  traderAddress,
  txHash,
  wei,
} from "@/features/sessions/api/__tests__/support/tradeHistoryFixtures";
import { sessionStatsKey } from "@/features/sessions/api/getSessionStats";
import { sessionTradesKey } from "@/features/sessions/api/getSessionTrades";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";

/**
 * My trades when the pool prices or the trade wallet's predictions fail to read: the tab says so only while
 * it has nothing to show, and a later read that fails keeps what an earlier one showed.
 */

const state = vi.hoisted(() => ({
  account: undefined as { address: `0x${string}`; chainId: number } | undefined,
  tradeWallet: null as `0x${string}` | null,
  tables: undefined as { Position?: Record<string, unknown>[] } | undefined,
  /** The query of this name rejects, read on every call. */
  failing: undefined as string | undefined,
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
  useExecutor: () => ({
    data: { predicted: state.tradeWallet, deployed: state.tradeWallet },
    isPending: false,
    isError: false,
    isSuccess: true,
  }),
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

const NOW = 1_756_000_000;
const ME = "0x0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0eb0b1" as Address;
const MY_WALLET = traderAddress(0) as Address;

const position = (token: string, amount: string) => ({
  id: `${MY_WALLET}-${token}`,
  executor_id: MY_WALLET,
  token,
  balance: wei(amount),
  updatedAt: String(NOW),
});

/** An outright buy of 10 tokens of one side for `paid`. */
const buyTen = (tx: number, option: Option, side: "up" | "down", paid: string) =>
  predictionRow({
    tx: txHash(tx),
    executor: MY_WALLET,
    option,
    timestamp: NOW - tx * 60,
    columns: {
      underlyingDelta: `-${wei(paid)}`,
      [`${side}Delta`]: wei("10"),
      [`${side}Balance`]: wei("10"),
      [`${side}SwapUnderlying`]: `-${wei(paid)}`,
      [`${side}SwapTokens`]: wei("10"),
    },
  });

/**
 * Gerwig 10 UP bought for 2.63 and Villeneuve 10 DOWN for 5.78. At the fixtures' spot (UP 0.3, DOWN 0.7)
 * they are worth 3 and 7: +0.37 and +1.22, a total of +1.59.
 */
const traded = (): Tables => ({
  ...baseTables(),
  Executor: [{ ...executorRow(MY_WALLET), owner: ME.toLowerCase() }],
  Prediction: [buyTen(1, GERWIG, "up", "2.63"), buyTen(2, VILLENEUVE, "down", "5.78")],
  Position: [position(GERWIG.upToken, "10"), position(VILLENEUVE.downToken, "10")],
});

const operationName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

function renderPage(tables: Tables) {
  const answers = indexerAnswers(createFakeIndexer(tables));
  state.tables = tables;
  fetchMock.mockImplementation((async (document: DocumentNode, variables?: Record<string, unknown>) => {
    if (operationName(document) === state.failing) throw new Error("The indexer answered 503");
    return answers(document, variables);
  }) as typeof fetchGraphql);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MarketPage parentMarket={addresses.parentMarket} />
    </QueryClientProvider>,
  );
  return client;
}

async function openMyTrades(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole("tab", { name: /my trades/i }));
  return screen.findByRole("tabpanel");
}

const textOf = (element: HTMLElement) => element.textContent ?? "";
const totalOf = (panel: HTMLElement) => within(panel).getByText("Expected P&L").parentElement!;

/** Whether the error copy shows within half a second; a failed read that keeps its data changes nothing else. */
const errorCopyAppears = (panel: HTMLElement) =>
  within(panel)
    .findByText(/Could not load your trades/, undefined, { timeout: 500 })
    .then(
      () => true,
      () => false,
    );

beforeEach(() => {
  fetchMock.mockReset();
  state.account = { address: ME, chainId: DEFAULT_CHAIN_ID };
  state.tradeWallet = MY_WALLET;
  state.tables = undefined;
  state.failing = undefined;
});

describe("My trades when a read fails after one succeeded", () => {
  it("keeps the trades and P&L it showed when the pool prices fail to reload", async () => {
    const client = renderPage(traded());
    const panel = await openMyTrades();
    await waitFor(() => expect(textOf(panel)).toMatch(amountPattern("1.59")));

    state.failing = "SessionStats";
    await client.invalidateQueries({ queryKey: sessionStatsKey(SESSION_ID) });

    expect(client.getQueryState(sessionStatsKey(SESSION_ID))?.status).toBe("error");
    expect(await errorCopyAppears(panel)).toBe(false);
    expect(textOf(panel)).toMatch(amountPattern("2.63"));
    expect(textOf(panel)).toMatch(amountPattern("5.78"));
    expect(textOf(totalOf(panel))).toMatch(amountPattern("1.59"));
  });

  it("keeps the trades and P&L it showed when the trade wallet's predictions fail to reload", async () => {
    const client = renderPage(traded());
    const panel = await openMyTrades();
    await waitFor(() => expect(textOf(panel)).toMatch(amountPattern("1.59")));
    const walletReads = [...sessionTradesKey(SESSION_ID), "wallet"];

    state.failing = "WalletTrades";
    await client.invalidateQueries({ queryKey: walletReads });

    const statuses = client
      .getQueryCache()
      .findAll({ queryKey: walletReads })
      .map((query) => query.state.status);
    expect(statuses).toContain("error");
    expect(await errorCopyAppears(panel)).toBe(false);
    expect(textOf(panel)).toMatch(amountPattern("2.63"));
    expect(textOf(panel)).toMatch(amountPattern("5.78"));
    expect(textOf(totalOf(panel))).toMatch(amountPattern("1.59"));
  });
});

describe("My trades after a read that never answered", () => {
  it("shows the trades and P&L once the pool prices load on a later read", async () => {
    state.failing = "SessionStats";
    const client = renderPage(traded());
    const panel = await openMyTrades();
    await within(panel).findByText(/Could not load your trades/);

    state.failing = undefined;
    await client.invalidateQueries({ queryKey: sessionStatsKey(SESSION_ID) });

    await waitFor(() => {
      expect(textOf(screen.getByRole("tabpanel"))).toMatch(amountPattern("2.63"));
      expect(textOf(screen.getByRole("tabpanel"))).toMatch(amountPattern("1.59"));
    });
  });
});

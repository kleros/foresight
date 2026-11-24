import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocumentNode } from "graphql";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeIndexer, type Tables } from "@/features/sessions/api/__tests__/support/fakeIndexer";
import {
  OPTIONS,
  amountPattern,
  baseTables,
  executorRow,
  indexerAnswers,
  predictionRow,
  traderAddress,
  transferRow,
  txHash,
  wei,
} from "@/features/sessions/api/__tests__/support/tradeHistoryFixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { gnosisRouterAddress } from "@/config/contracts";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";

/**
 * Issue 2026-11-24-foresight-redeem-7-indexer-pnl, A3: a redeem is not a trade. The tables are what the indexer
 * writes for a trade wallet that predicted twice and then redeemed: the redeem's router transfers and the balances
 * it left, and no Prediction row for its transaction.
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

const NOW = Math.floor(Date.now() / 1000) - 60;
const ME = "0x0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0eb0b1" as Address;
const MY_WALLET = traderAddress(0);
const GNOSIS_ROUTER = gnosisRouterAddress(100)!.toLowerCase();
const CONDITIONAL_ROUTER = "0x774284d5cdfec3a0a0ebc7283ad4d5b33013c29c";
const SDAI = addresses.collateralToken.toLowerCase();
const REDEEM_TX = txHash(9);

const position = (token: string, amount: string) => ({
  id: `${MY_WALLET}-${token}`,
  executor_id: MY_WALLET,
  token,
  balance: wei(amount),
  updatedAt: String(NOW),
});

/** Gerwig: 10 UP for 2.63. Villeneuve: 10 DOWN for 5.78 and 4 parent tokens left over. */
const predictions = () => [
  predictionRow({
    tx: txHash(1),
    executor: MY_WALLET,
    option: GERWIG,
    timestamp: NOW - 120,
    columns: {
      underlyingDelta: `-${wei("2.63")}`,
      upDelta: wei("10"),
      upBalance: wei("10"),
      upSwapUnderlying: `-${wei("2.63")}`,
      upSwapTokens: wei("10"),
      upAvgPrice: wei("0.263"),
    },
  }),
  predictionRow({
    tx: txHash(2),
    executor: MY_WALLET,
    option: VILLENEUVE,
    timestamp: NOW - 60,
    columns: {
      underlyingDelta: `-${wei("5.78")}`,
      downDelta: wei("10"),
      downBalance: wei("10"),
      downSwapUnderlying: `-${wei("5.78")}`,
      downSwapTokens: wei("10"),
      downAvgPrice: wei("0.578"),
    },
  }),
];

/** One batch: Gerwig's 10 UP through the conditional router, Villeneuve's 4 parent tokens through Seer's router. */
const redeemTransfers = () =>
  (
    [
      [1, GERWIG.upToken, `-${wei("10")}`, CONDITIONAL_ROUTER],
      [2, SDAI, wei("7"), CONDITIONAL_ROUTER],
      [3, VILLENEUVE.underlyingToken, `-${wei("4")}`, GNOSIS_ROUTER],
      [4, SDAI, wei("4"), GNOSIS_ROUTER],
    ] as const
  ).map(([logIndex, token, amount, counterparty]) =>
    transferRow({ tx: REDEEM_TX, logIndex, executor: MY_WALLET, token, amount, counterparty, timestamp: NOW }),
  );

function redeemedTables(): Tables {
  return {
    ...baseTables(),
    Executor: [{ ...executorRow(MY_WALLET), owner: ME.toLowerCase() }],
    Transfer: redeemTransfers(),
    Prediction: predictions(),
    Position: [
      position(GERWIG.upToken, "0"),
      position(VILLENEUVE.downToken, "10"),
      position(VILLENEUVE.underlyingToken, "0"),
      position(SDAI, "11"),
    ],
  };
}

function renderPage(tables: Tables) {
  const answers = indexerAnswers(createFakeIndexer(tables));
  state.tables = tables;
  fetchMock.mockImplementation((async (document: DocumentNode, variables?: Record<string, unknown>) =>
    answers(document, variables)) as typeof fetchGraphql);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MarketPage parentMarket={addresses.parentMarket} />
    </QueryClientProvider>,
  );
}

async function openMyTrades(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole("tab", { name: /my trades/i }));
  return screen.findByRole("tabpanel");
}

const textOf = (element: HTMLElement) => element.textContent ?? "";
/** The trade list's rows: each prediction is a row whose button opens its detail. */
async function tradeRows(panel: HTMLElement): Promise<HTMLElement[]> {
  const sized = await within(panel).findAllByText(amountPattern("2.63"));
  const list = sized.map((element) => element.closest("button")?.closest("ul")).find((each) => each != null);
  expect(list, "the trade list").toBeTruthy();
  return within(list as HTMLElement).getAllByRole("listitem");
}

beforeEach(() => {
  fetchMock.mockReset();
  state.account = { address: ME, chainId: DEFAULT_CHAIN_ID };
  state.tradeWallet = MY_WALLET as Address;
  state.tables = undefined;
});

describe("My trades after a redeem (A3)", () => {
  it("lists the two predictions and no trade for the redeem", async () => {
    renderPage(redeemedTables());

    const panel = await openMyTrades();

    await waitFor(() => {
      expect(textOf(panel)).toMatch(amountPattern("2.63"));
      expect(textOf(panel)).toMatch(amountPattern("5.78"));
    });
    const rows = await tradeRows(panel);
    expect(rows).toHaveLength(2);
    expect(textOf(rows[0]!)).toMatch(amountPattern("5.78"));
    expect(textOf(rows[1]!)).toMatch(amountPattern("2.63"));
  });
});

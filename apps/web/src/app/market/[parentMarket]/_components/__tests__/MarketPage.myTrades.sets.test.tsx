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
  type Option,
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

import { fetchGraphql } from "@/lib/graphql/batcher";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";

/**
 * My trades for an option the wallet minted sets in: a set mints the child's INVALID with UP and DOWN, so the
 * page reads the trade wallet's INVALID balance beside them, and UP and DOWN that arrive with no INVALID are a
 * plain transfer whose P&L is unavailable.
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

const NOW = 1_756_000_000;
const ME = "0x0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0eb0b1" as Address;
const MY_WALLET = traderAddress(0) as Address;

/** Gerwig keeps the fixtures' child INVALID; Villeneuve gets its own, as every child market has. */
const GERWIG_INVALID = addresses.childInvalidToken.toLowerCase();
const VILLENEUVE_INVALID = "0xb5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5";
const [gerwigChild, villeneuveChild] = sessionDetailAnswer.Session[0]!.children;
const detailAnswer = {
  Session: [
    {
      ...sessionDetailAnswer.Session[0]!,
      children: [
        { ...gerwigChild!, invalidToken: GERWIG_INVALID as Address },
        { ...villeneuveChild!, invalidToken: VILLENEUVE_INVALID as Address },
      ],
    },
  ],
};

const position = (token: string, amount: string) => ({
  id: `${MY_WALLET}-${token}`,
  executor_id: MY_WALLET,
  token,
  balance: wei(amount),
  updatedAt: String(NOW),
});

/** Villeneuve: 10 DOWN bought for 5.78, worth 7 at the fixtures' DOWN spot of 0.7: +1.22. */
const villeneuveBuy = () =>
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
  });

function tablesWith(gerwig: { columns: Record<string, string>; held: Record<string, string> }): Tables {
  return {
    ...baseTables(),
    Executor: [{ ...executorRow(MY_WALLET), owner: ME.toLowerCase() }],
    Prediction: [
      predictionRow({ tx: txHash(1), executor: MY_WALLET, option: GERWIG, timestamp: NOW, columns: gerwig.columns }),
      villeneuveBuy(),
    ],
    Position: [
      ...Object.entries(gerwig.held).map(([token, amount]) => position(token, amount)),
      position(VILLENEUVE.downToken, "10"),
    ],
  };
}

const operationName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

function renderPage(tables: Tables) {
  const answers = indexerAnswers(createFakeIndexer(tables));
  state.tables = tables;
  fetchMock.mockImplementation((async (document: DocumentNode, variables?: Record<string, unknown>) =>
    operationName(document) === "SessionDetail" ? detailAnswer : answers(document, variables)) as typeof fetchGraphql);
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

const SYMBOL = sessionDetailAnswer.Session[0]!.collateralSymbol;
const textOf = (element: HTMLElement) => element.textContent ?? "";
const totalOf = (panel: HTMLElement) => within(panel).getByText("Expected P&L").parentElement!;
const positionRow = (panel: HTMLElement, option: Option) => {
  const summary = within(panel).getByText("Expected P&L").closest("section")!;
  return within(summary).getByText(option.name).closest("li")!;
};

beforeEach(() => {
  fetchMock.mockReset();
  state.account = { address: ME, chainId: DEFAULT_CHAIN_ID };
  state.tradeWallet = MY_WALLET;
  state.tables = undefined;
});

describe("My trades for sets minted against the INVALID held (A5)", () => {
  it("values a mint whose INVALID the trade wallet holds", async () => {
    renderPage(
      tablesWith({
        // mint 10 sets, sell the 10 DOWN for 6.5: cost 3.5, keeping 10 UP and 10 INVALID
        columns: {
          upDelta: wei("10"),
          upBalance: wei("10"),
          downSwapTokens: `-${wei("10")}`,
          downSwapUnderlying: wei("6.5"),
          downAvgPrice: wei("0.65"),
        },
        held: { [GERWIG.upToken]: "10", [GERWIG_INVALID]: "10" },
      }),
    );

    const panel = await openMyTrades();

    // 10 UP at the fixtures' UP spot of 0.3 is worth 3 against 3.5 put in: -0.5, 14.28% of the cost
    await waitFor(() => expect(textOf(positionRow(panel, GERWIG))).toContain(`~-0.5 ${SYMBOL} (-14.28%)`));
    // with Villeneuve's +1.22: +0.72
    expect(textOf(totalOf(panel))).toMatch(amountPattern("0.72"));
    expect(textOf(panel)).not.toMatch(/P&L unavailable/);
  });

  it("marks P&L unavailable for UP and DOWN that arrived by plain transfer, with no INVALID", async () => {
    renderPage(
      tablesWith({
        // 2 UP and 2 DOWN from the owner's wallet: the row reads like a mint of 2
        columns: { upDelta: wei("2"), upBalance: wei("2"), downDelta: wei("2"), downBalance: wei("2") },
        held: { [GERWIG.upToken]: "2", [GERWIG.downToken]: "2" },
      }),
    );

    const panel = await openMyTrades();

    await waitFor(() => expect(textOf(positionRow(panel, GERWIG))).toMatch(/P&L unavailable/));
    expect(textOf(panel)).toMatch(/Excludes 1 option/);
    expect(textOf(totalOf(panel))).toMatch(amountPattern("1.22"));
  });
});

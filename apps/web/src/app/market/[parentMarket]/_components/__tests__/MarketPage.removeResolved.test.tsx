import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { removeInput, SESSION } from "@/features/liquidity/run/__tests__/support/requests";
import { fetchSessionResolution, type SessionResolution } from "@/features/resolution/api/getSessionResolution";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { executorAddress } from "@/lib/trade-executor/executor";

import { tradeExecutorFactoryAddress } from "@/config/contracts";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";

/**
 * A4: Remove liquidity stays available once the session's parent has resolved, before and after its resolution
 * date. The session's liquidity is the hook's answer; the page and the positions popup are real.
 */
const liquidity = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("@/features/liquidity/hooks/useSessionLiquidity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/liquidity/hooks/useSessionLiquidity")>()),
  useSessionLiquidity: () => liquidity.value,
}));
vi.mock("@/features/resolution/api/getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/resolution/api/getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  sessionFactoryAddress: () => "0x5f00000000000000000000000000000000000000",
}));
vi.mock("@/features/sessions/api/verifySession", () => ({
  verifySession: async (_client: unknown, _chain: number, row: unknown) => row,
}));
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://cdn.example.link/ipfs" }));
vi.mock("@/features/trade-executor/components/TradeWallet/TradeWallet", () => ({ TradeWallet: () => null }));
vi.mock("../useOptionPositions", () => ({ useOptionPositions: () => ({}) }));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: undefined }),
}));

const fetchMock = vi.mocked(fetchGraphql);
const readerMock = vi.mocked(fetchSessionResolution);

const TITLE = "Dune: Part Three, director";
const WAD = 10n ** 18n;
const UP_POOL = "Denis Villeneuve UP pool";
const DOWN_POOL = "Denis Villeneuve DOWN pool";
const tradeWallet = executorAddress(tradeExecutorFactoryAddress(100)!, removeInput().owner);

const RESOLVED: SessionResolution = {
  parent: {
    resolved: true,
    invalid: false,
    winningOutcomes: [0],
    payoutNumerators: [1n, 0n, 0n],
    payoutDenominator: 1n,
  },
  children: { 0: { deployed: true, market: addresses.childMarkets[0], resolved: false } },
};

const walletRow = {
  key: "0:up",
  pool: UP_POOL,
  count: 1,
  returns: [{ label: "sDAI", amount: WAD }],
  heldBy: "wallet" as const,
  request: { kind: "remove" as const, session: SESSION, input: removeInput({ tokenIds: [78n] }) },
};
const tradeWalletRow = {
  key: "tradeWallet:0:down",
  pool: DOWN_POOL,
  count: 1,
  returns: [{ label: "sDAI", amount: WAD }],
  heldBy: "tradeWallet" as const,
  request: {
    kind: "remove" as const,
    session: SESSION,
    input: { ...removeInput({ tokenIds: [77n] }), tradeWallet },
  },
};

const start = vi.fn();

function holdingPositions() {
  liquidity.value = {
    names: ["Denis Villeneuve"],
    pools: { data: undefined, isError: false },
    hasLiquidity: true,
    balances: undefined,
    chainTime: undefined,
    owner: removeInput().owner,
    positions: [walletRow, tradeWalletRow],
    positionsUnread: false,
    rereadPositions: () => {},
    merge: undefined,
    run: {
      progress: { stage: "idle", rows: [], signatures: { done: 0, total: 0 } },
      start,
      resume: () => {},
      retry: () => {},
      reset: () => {},
      discard: () => {},
      isRunning: false,
      isHeld: false,
    },
  };
}

const queryName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

/** A set-up session whose resolution date is `openingTime`, in unix seconds. */
function answerSession(openingTime: string) {
  fetchMock.mockImplementation(async (document) => {
    if (queryName(document) === "SessionDetail") {
      return { Session: [{ ...sessionDetailColumns, openingTime, children: [sessionChildRow()] }] };
    }
    if (queryName(document) === "SessionChart") return new Promise(() => {});
    return { Prediction: [], directSwaps: [], senderlessSwaps: [], Pool: [] };
  });
}

async function renderResolvedPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MarketPage parentMarket={addresses.parentMarket} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { level: 1, name: TITLE });
  await waitFor(() => expect(screen.getByText("Resolved")).toBeInTheDocument());
}

beforeEach(() => {
  fetchMock.mockReset();
  readerMock.mockReset();
  readerMock.mockResolvedValue(RESOLVED);
  start.mockReset();
  holdingPositions();
});

describe.each([
  ["after its resolution date", "1760000000"],
  ["before its resolution date", "4102444800"],
])("MarketPage A4 on a resolved session, %s", (_when, openingTime) => {
  beforeEach(() => answerSession(openingTime));

  it("offers Your positions in the Liquidity section", async () => {
    await renderResolvedPage();

    const section = screen.getByRole("region", { name: "Liquidity" });
    expect(within(section).getByRole("button", { name: "Your positions" })).toBeEnabled();
  });

  it("offers an enabled Remove for the wallet's and the trade wallet's positions", async () => {
    await renderResolvedPage();

    await userEvent.click(screen.getByRole("button", { name: "Your positions" }));
    const popup = await screen.findByRole("dialog");

    const removes = within(popup).getAllByRole("button", { name: /^Remove / });
    expect(removes).toHaveLength(2);
    for (const remove of removes) expect(remove).toBeEnabled();
  });

  it("starts the pressed position's remove", async () => {
    await renderResolvedPage();

    await userEvent.click(screen.getByRole("button", { name: "Your positions" }));
    const popup = await screen.findByRole("dialog");
    await userEvent.click(within(popup).getByRole("button", { name: new RegExp(`^Remove ${UP_POOL},`) }));

    expect(start).toHaveBeenCalledWith(walletRow.request);
  });
});

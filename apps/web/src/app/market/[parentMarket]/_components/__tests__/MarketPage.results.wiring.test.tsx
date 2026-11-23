import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import {
  fetchSessionResolution,
  type ChildResolution,
  type SessionResolution,
  type SessionResolutionRequest,
} from "@/features/resolution/api/getSessionResolution";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";

vi.mock("@/features/resolution/api/getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/resolution/api/getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  sessionFactoryAddress: () => "0x5f00000000000000000000000000000000000000",
}));
vi.mock("@/features/liquidity/api/getLiquidityPools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/liquidity/api/getLiquidityPools")>()),
  useLiquidityPools: () => ({ data: undefined, isError: false }),
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
/** Mixed-case ids, as a checksummed address reads. */
const OPTIONS = [
  { index: 0, name: "Denis Villeneuve", market: "0xAbCdEf0000000000000000000000000000000001" as Address },
  { index: 1, name: "Greta Gerwig", market: "0xAbCdEf0000000000000000000000000000000002" as Address },
] as const;

const children: Record<number, ChildResolution> = {
  0: {
    deployed: true,
    market: OPTIONS[0].market,
    resolved: true,
    invalid: true,
    finalValue: null,
    payoutNumerators: [0n, 0n, 1n],
    payoutDenominator: 1n,
  },
  1: { deployed: true, market: OPTIONS[1].market, resolved: false },
};

async function answer(request: SessionResolutionRequest): Promise<SessionResolution> {
  const outcomes = request.parentOutcomes ?? OPTIONS.map(({ index }) => index);
  return {
    parent: {
      resolved: true,
      invalid: false,
      winningOutcomes: [0, 1],
      payoutNumerators: [1n, 1n, 0n],
      payoutDenominator: 2n,
    },
    children: Object.fromEntries(outcomes.map((index) => [index, children[index]!])),
  };
}

const queryName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

const card = (name: string) =>
  screen.getByRole("heading", { level: 3, name }).closest("button[aria-expanded]")!.parentElement as HTMLElement;

beforeEach(() => {
  fetchMock.mockReset();
  readerMock.mockReset();
  readerMock.mockImplementation((_client, request) => answer(request));
  useEstimateStore.setState({ estimates: {} });
  const rows = OPTIONS.map(({ index, name, market }) =>
    sessionChildRow({ id: market, parentOutcomeIndex: String(index), parentOutcome: name, displayName: name }),
  );
  fetchMock.mockImplementation(async (document) =>
    queryName(document) === "SessionDetail"
      ? { Session: [{ ...sessionDetailColumns, openingTime: "1756900800", children: rows }] }
      : { Prediction: [], directSwaps: [], senderlessSwaps: [], Pool: [] },
  );
});

describe("MarketPage hands each option card its result", () => {
  it("finds a mixed-case market's result and names the collateral an INVALID child pays in", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MarketPage parentMarket={addresses.parentMarket} />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { level: 1, name: TITLE });
    await act(async () => {
      await Promise.all(readerMock.mock.results.map(({ value }) => value));
    });

    await waitFor(() =>
      expect(card(OPTIONS[0].name)).toHaveTextContent(
        "Invalid: DOWN pays 0 sDAI, UP pays 0 sDAI, INVALID pays 0.5 sDAI.",
      ),
    );
    expect(card(OPTIONS[1].name)).toHaveTextContent("Waiting for result");
  });
});

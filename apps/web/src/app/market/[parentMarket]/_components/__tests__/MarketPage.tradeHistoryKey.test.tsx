import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { createFakeIndexer } from "@/features/sessions/api/__tests__/support/fakeIndexer";
import {
  SESSION_ID,
  OPTIONS,
  addressSuffix,
  baseTables,
  executorRow,
  indexerAnswers,
  predictionRow,
  traderAddress,
  txHash,
  wei,
} from "@/features/sessions/api/__tests__/support/tradeHistoryFixtures";
import { sessionTradesKey } from "@/features/sessions/api/getSessionTrades";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";

/**
 * Acceptance test A5 of issue 2026-10-30-foresight-market-trade-history, its other half: the
 * history's query is cached under `sessionTradesKey(sessionId)`, the key `refreshSessionAfterTrade`
 * invalidates (getSessionStats.tradeHistory.test.ts), so that invalidation reaches the list.
 */

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
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

it("caches the All trades query under the trade-history key once the list shows", async () => {
  const trader = traderAddress(0);
  const fake = createFakeIndexer({
    ...baseTables(),
    Executor: [executorRow(trader)],
    Prediction: [
      predictionRow({
        tx: txHash(1),
        executor: trader,
        option: OPTIONS.gerwig,
        timestamp: Math.floor(Date.now() / 1000) - 60,
        columns: { underlyingDelta: `-${wei("2")}` },
      }),
    ],
  });
  vi.mocked(fetchGraphql).mockImplementation(indexerAnswers(fake) as typeof fetchGraphql);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MarketPage parentMarket={addresses.parentMarket} />
    </QueryClientProvider>,
  );

  await screen.findByText(new RegExp(addressSuffix(trader), "i"));

  expect(client.getQueryCache().findAll({ queryKey: sessionTradesKey(SESSION_ID) }).length).toBeGreaterThan(0);
});

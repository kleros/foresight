import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeIndexer } from "@/features/sessions/api/__tests__/support/fakeIndexer";
import { baseTables, indexerAnswers } from "@/features/sessions/api/__tests__/support/tradeHistoryFixtures";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { GATEWAY } from "@/testing/fixtures";

import { TradeHistory } from "../TradeHistory";

vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
/* The My trades tab reads the wallet and its trade wallet; these tests are about All trades only. */
vi.mock("../MyTrades", () => ({ MyTrades: () => null }));

const fetchMock = vi.mocked(fetchGraphql);
const session = toSessionDetail({ ...sessionDetailColumns, children: [sessionChildRow()] }, GATEWAY);

function renderHistory() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TradeHistory session={session} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("All trades while the trades load, fail or are none", () => {
  it("shows a busy skeleton while the trades load", () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));

    const { container } = renderHistory();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("says the trades could not load when the indexer fails", async () => {
    fetchMock.mockRejectedValue(new Error("indexer down"));

    renderHistory();

    expect(await screen.findByText(/could not load the trades/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });

  it("says there are no trades yet, with nothing more to load, when the session has none", async () => {
    fetchMock.mockImplementation(indexerAnswers(createFakeIndexer(baseTables())) as typeof fetchGraphql);

    renderHistory();

    expect(await screen.findByText("No trades yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });
});

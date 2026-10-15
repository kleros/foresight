import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sessionKey } from "@/features/sessions/api/getSession";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";

vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
/* The factory cannot reference imports, so GATEWAY's value is restated. */
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://cdn.example.link/ipfs" }));
/* The wallet reaches wagmi and the RPC config, neither of which this page's tests supply. */
vi.mock("@/features/trade-executor/components/TradeWallet/TradeWallet", () => ({
  TradeWallet: ({ noun }: { noun: string }) => <p data-testid="trade-wallet-noun">{noun}</p>,
}));
vi.mock("../useOptionPositions", () => ({ useOptionPositions: () => ({}) }));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: undefined }),
}));

const fetchMock = vi.mocked(fetchGraphql);

const sessionResult = { Session: [{ ...sessionDetailColumns, children: [] }] };

const queryName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

/** Answers each query by name; the chart's answer is built per call, so a rejection exists only once a query adopts it. */
function answerQueries(chart: () => unknown) {
  fetchMock.mockImplementation(async (document) => {
    if (queryName(document) === "SessionDetail") {
      return { Session: [{ ...sessionDetailColumns, children: [sessionChildRow()] }] };
    }
    if (queryName(document) === "SessionChart") return chart();
    return { Prediction: [], Pool: [] };
  });
}

function renderPage(parentMarket: string = addresses.parentMarket) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <MarketPage parentMarket={parentMarket} />
    </QueryClientProvider>,
  );
  return { client, container };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("MarketPage", () => {
  it("reports no session without asking the backend when the address is not one", () => {
    renderPage("not-an-address");

    expect(screen.getByText("No session found")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports no session at an address without one", async () => {
    fetchMock.mockResolvedValueOnce({ Session: [] });

    renderPage();

    expect(await screen.findByText("No session found")).toBeInTheDocument();
  });

  it("shows the error screen when the first load fails", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));

    renderPage();

    expect(await screen.findByText("Could not load this session")).toBeInTheDocument();
  });

  it("keeps showing the loaded session when a background refetch fails", async () => {
    fetchMock.mockResolvedValueOnce(sessionResult);
    fetchMock.mockRejectedValue(new Error("boom"));

    const { client } = renderPage();
    await screen.findByRole("heading", { level: 1, name: "Dune: Part Three, director" });

    /* act flushes the re-render the failed refetch triggers, so the DOM below is post-error. */
    await act(() => client.refetchQueries());

    expect(client.getQueryState(sessionKey(addresses.parentMarket))?.status).toBe("error");
    expect(screen.getByRole("heading", { level: 1, name: "Dune: Part Three, director" })).toBeInTheDocument();
    expect(screen.queryByText("Could not load this session")).toBeNull();
  });

  /* The chart itself is canvas: rendered states would need the real component under
     jsdom or a stub asserting its own scaffolding, so they are verified live instead. */
  it("says the price history failed instead of drawing nothing", async () => {
    answerQueries(() => Promise.reject(new Error("boom")));

    renderPage();

    expect(await screen.findByText("Could not load the price history. Reload in a moment.")).toBeInTheDocument();
  });

  it("holds the chart's place while the price history loads", async () => {
    answerQueries(() => new Promise(() => {}));

    const { container } = renderPage();
    await screen.findByRole("heading", { level: 1, name: "Dune: Part Three, director" });

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("gives no two elements on the session page the same expand-button id", async () => {
    fetchMock.mockImplementation(async (document) =>
      queryName(document) === "SessionDetail"
        ? {
            Session: [
              {
                ...sessionDetailColumns,
                children: [
                  sessionChildRow(),
                  sessionChildRow({
                    id: addresses.childMarkets[1],
                    parentOutcomeIndex: "0",
                    displayName: "Denis Villeneuve",
                  }),
                ],
              },
            ],
          }
        : { Prediction: [], Pool: [] },
    );

    renderPage();
    await screen.findByRole("heading", { name: "Denis Villeneuve" });

    expect(document.querySelectorAll("#expand-button").length).toBeLessThanOrEqual(1);
  });
});

describe("MarketPage's trade wallet", () => {
  function answerItemName(itemName: string) {
    fetchMock.mockImplementation(async (document) => {
      if (queryName(document) === "SessionDetail") {
        return { Session: [{ ...sessionDetailColumns, itemName, children: [sessionChildRow()] }] };
      }
      return { Prediction: [], Pool: [], SessionChart: [] };
    });
  }

  it("names the options in the singular, lower-cased, as in Mint director tokens", async () => {
    answerItemName("Director");
    renderPage();

    expect(await screen.findByTestId("trade-wallet-noun")).toHaveTextContent(/^director$/);
  });

  it("falls back to branch when the session names no item", async () => {
    answerItemName("");
    renderPage();

    expect(await screen.findByTestId("trade-wallet-noun")).toHaveTextContent(/^branch$/);
  });
});

describe("MarketPage on a trading session", () => {
  const NO_LIQUIDITY = "None of the directors can be traded yet.";

  /** Closes on 1 January 2100, so the session is trading whatever the wall clock reads. */
  function answerTrading(chart: () => unknown) {
    fetchMock.mockImplementation(async (document) => {
      if (queryName(document) === "SessionDetail") {
        return { Session: [{ ...sessionDetailColumns, openingTime: "4102444800", children: [sessionChildRow()] }] };
      }
      if (queryName(document) === "SessionChart") return chart();
      return { Prediction: [], Pool: [] };
    });
  }

  it("does not call the options illiquid while the price history loads", async () => {
    answerTrading(() => new Promise(() => {}));

    renderPage();
    await screen.findByRole("button", { name: /^Predict (\d+ )?estimates?$/ });

    expect(screen.queryByText(NO_LIQUIDITY)).toBeNull();
  });

  it("does not call the options illiquid when the price history failed", async () => {
    answerTrading(() => Promise.reject(new Error("boom")));

    renderPage();
    await screen.findByText("Could not load the price history. Reload in a moment.");

    expect(screen.queryByText(NO_LIQUIDITY)).toBeNull();
  });
});

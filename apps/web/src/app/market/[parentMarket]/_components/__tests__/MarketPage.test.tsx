import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sessionKey } from "@/features/sessions/api/getSession";
import { sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";

vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
/* The factory cannot reference imports, so GATEWAY's value is restated. */
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://cdn.example.link/ipfs" }));

const fetchMock = vi.mocked(fetchGraphql);

const sessionResult = { Session: [{ ...sessionDetailColumns, children: [] }] };

function renderPage(parentMarket: string = addresses.parentMarket) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MarketPage parentMarket={parentMarket} />
    </QueryClientProvider>,
  );
  return client;
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

    const client = renderPage();
    await screen.findByRole("heading", { level: 1, name: "Dune: Part Three, director" });

    /* act flushes the re-render the failed refetch triggers, so the DOM below is post-error. */
    await act(() => client.refetchQueries());

    expect(client.getQueryState(sessionKey(addresses.parentMarket))?.status).toBe("error");
    expect(screen.getByRole("heading", { level: 1, name: "Dune: Part Three, director" })).toBeInTheDocument();
    expect(screen.queryByText("Could not load this session")).toBeNull();
  });
});

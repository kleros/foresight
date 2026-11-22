import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSessionResolution, type ParentResolution } from "@/features/resolution/api/getSessionResolution";
import { sessionColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { makeQueryClient } from "@/lib/query";

import { SessionBrowser } from "@/app/(homepage)/_components/SessionBrowser";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://cdn.example.link/ipfs" }));
vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  sessionFactoryAddress: () => "0xfac7000000000000000000000000000000000001",
}));
vi.mock("@/features/resolution/api/getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/resolution/api/getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));

const graphqlMock = vi.mocked(fetchGraphql);
const resolutionMock = vi.mocked(fetchSessionResolution);

const RESOLVED: ParentResolution = {
  resolved: true,
  invalid: false,
  winningOutcomes: [0],
  payoutNumerators: [1n, 0n, 0n],
  payoutDenominator: 1n,
};

const row = (id: string, title: string) => ({
  ...sessionColumns,
  id,
  parentMarket: `0x${id.padStart(40, "0")}`,
  title,
  itemNamePlural: "Talks",
  outcomeCount: "2",
  keyword: title.toLowerCase(),
});

function answer(byId: Record<string, ParentResolution | Error>) {
  resolutionMock.mockImplementation(async (_client, request) => {
    const reply = byId[String(request.sessionId)] ?? { resolved: false };
    if (reply instanceof Error) throw reply;
    return { parent: reply, children: {} };
  });
}

function renderHomepage(rows: ReturnType<typeof row>[]) {
  graphqlMock.mockResolvedValue({ SessionCounter: [{ count: rows.length }], Session: rows });
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <SessionBrowser />
    </QueryClientProvider>,
  );
}

const card = (name: string) => screen.getByRole("link", { name: new RegExp(name) });

beforeEach(() => {
  graphqlMock.mockReset();
  resolutionMock.mockReset();
});

describe("the homepage's per-session resolution", () => {
  it("says a session's status is unknown on its card when its read fails", async () => {
    answer({ "21": new Error("HTTP request failed") });
    renderHomepage([row("21", "Unread talks"), row("22", "Open talks")]);

    await waitFor(() => expect(within(card("Unread talks")).getByText("Status unknown")).toBeInTheDocument());
    expect(within(card("Open talks")).queryByText("Status unknown")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Resolved" })).toBeNull();
  });

  it("lists every session under Resolved when each one's parent resolved", async () => {
    answer({ "21": RESOLVED, "22": RESOLVED });
    renderHomepage([row("21", "First talks"), row("22", "Second talks")]);

    const heading = await screen.findByRole("heading", { name: "Resolved" });
    const group = within(heading.closest("section")!);
    await waitFor(() => expect(group.getAllByRole("link", { name: /talks/ })).toHaveLength(2));
  });

  it("reads each listed session of the factory by its own id, as a parent-only read", async () => {
    answer({});
    renderHomepage([row("21", "First talks"), row("22", "Second talks")]);
    await screen.findByRole("link", { name: /First talks/ });

    await waitFor(() => expect(resolutionMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    const ids = resolutionMock.mock.calls.map(([, request]) => request.sessionId);
    expect(new Set(ids)).toEqual(new Set([21n, 22n]));
    expect(resolutionMock.mock.calls.every(([, request]) => request.parentOutcomes?.length === 0)).toBe(true);
  });
});

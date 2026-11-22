import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSessionResolution, type ParentResolution } from "@/features/resolution/api/getSessionResolution";
import { sessionColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { makeQueryClient } from "@/lib/query";

import { SessionBrowser } from "@/app/(homepage)/_components/SessionBrowser";

/**
 * The homepage lists sessions from the indexer without waiting for resolution; each session's resolution loads
 * on its own through fetchSessionResolution (mocked), and a resolved one moves under the Resolved heading.
 */

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

const ROWS = [row("11", "Resolving talks"), row("12", "Trading talks")];

/** Each session's parent read, by session id; unlisted ids stay unresolved. */
function answerResolution(byId: Record<string, ParentResolution | Error | "pending">) {
  resolutionMock.mockImplementation((_client, request) => {
    const answer = byId[String(request.sessionId)] ?? { resolved: false };
    if (answer === "pending") return new Promise(() => {});
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve({ parent: answer, children: {} });
  });
}

function renderHomepage() {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <SessionBrowser />
    </QueryClientProvider>,
  );
}

const card = (name: string) => screen.getByRole("link", { name: new RegExp(name) });
const follows = (later: Element, earlier: Element) =>
  Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  graphqlMock.mockReset();
  resolutionMock.mockReset();
  graphqlMock.mockResolvedValue({ SessionCounter: [{ count: ROWS.length }], Session: ROWS });
});

describe("A5 the homepage groups resolved sessions, loading resolution per session", () => {
  it("lists the sessions while their resolution reads are still pending", async () => {
    answerResolution({ "11": "pending", "12": "pending" });
    renderHomepage();

    expect(await screen.findByRole("link", { name: /Resolving talks/ })).toBeInTheDocument();
    expect(card("Trading talks")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Resolved" })).toBeNull();
  });

  it("moves a session whose parent resolved under Resolved, below the sessions still trading", async () => {
    answerResolution({ "11": RESOLVED, "12": { resolved: false } });
    renderHomepage();

    const heading = await screen.findByRole("heading", { name: "Resolved" }, { timeout: 4_000 });
    expect(follows(card("Resolving talks"), heading)).toBe(true);
    expect(follows(heading, card("Trading talks"))).toBe(true);
    expect(resolutionMock.mock.calls.some(([, request]) => request.sessionId === 11n)).toBe(true);
  });

  it(
    "does not list a session under Resolved when its read fails",
    async () => {
      answerResolution({ "11": new Error("HTTP request failed"), "12": RESOLVED });
      renderHomepage();

      const heading = await screen.findByRole("heading", { name: "Resolved" }, { timeout: 4_000 });
      expect(follows(card("Trading talks"), heading)).toBe(true);
      await waitFor(() => expect(resolutionMock.mock.calls.some(([, request]) => request.sessionId === 11n)).toBe(true));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(follows(heading, card("Resolving talks"))).toBe(true);
    },
    10_000,
  );
});

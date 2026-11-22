import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSessionResolution, type ParentResolution } from "@/features/resolution/api/getSessionResolution";
import { sessionColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { makeQueryClient } from "@/lib/query";

import { SessionBrowser } from "@/app/(homepage)/_components/SessionBrowser";

/** A session whose resolution read fails shows status unknown on its card; one still reading shows no status. */

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
beforeEach(() => {
  graphqlMock.mockReset();
  resolutionMock.mockReset();
  graphqlMock.mockResolvedValue({ SessionCounter: [{ count: ROWS.length }], Session: ROWS });
});

const UNKNOWN = "Status unknown";

describe("the homepage shows a failed resolution read as status unknown", () => {
  it("marks the card whose read failed, and no other", async () => {
    answerResolution({ "11": new Error("HTTP request failed"), "12": { resolved: false } });
    renderHomepage();

    await waitFor(() => expect(card("Resolving talks")).toHaveTextContent(UNKNOWN), { timeout: 4_000 });
    expect(card("Trading talks")).not.toHaveTextContent(UNKNOWN);
    expect(screen.queryByRole("heading", { name: "Resolved" })).toBeNull();
  });

  it("shows no status while a read is pending", async () => {
    answerResolution({ "11": "pending", "12": "pending" });
    renderHomepage();

    await screen.findByRole("link", { name: /Resolving talks/ });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(card("Resolving talks")).not.toHaveTextContent(UNKNOWN);
    expect(card("Trading talks")).not.toHaveTextContent(UNKNOWN);
  });
});

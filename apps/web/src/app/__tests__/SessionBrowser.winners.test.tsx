import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSessionResolution } from "@/features/resolution/api/getSessionResolution";
import { sessionColumns } from "@/features/sessions/utils/__tests__/fixtures";
import type { SessionRow } from "@/features/sessions/utils/toSessionSummary";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { SessionBrowser } from "@/app/(homepage)/_components/SessionBrowser";

vi.mock("@/features/resolution/api/getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/resolution/api/getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  sessionFactoryAddress: () => "0x5f00000000000000000000000000000000000000",
}));
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://example.test/ipfs" }));

const ROW: SessionRow = {
  ...sessionColumns,
  id: "1",
  parentMarket: `0x${"1".padStart(40, "0")}`,
  title: "Resolved past talks",
  itemNamePlural: "Talks",
  outcomeCount: "3",
  keyword: "resolved past talks",
  openingTime: "1756900800",
};

const queryName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

function answer(winningOutcomes: number[]) {
  vi.mocked(fetchSessionResolution).mockResolvedValue({
    parent: {
      resolved: true,
      invalid: false,
      winningOutcomes,
      payoutNumerators: [1n, 0n, 1n, 0n],
      payoutDenominator: 2n,
    },
    children: {},
  });
  vi.mocked(fetchGraphql).mockImplementation(async (document) =>
    queryName(document) === "SessionOptionNames"
      ? {
          ChildMarket: [
            { parentOutcomeIndex: "2", parentOutcome: "talk-2", displayName: "Account abstraction today" },
            { parentOutcomeIndex: "0", parentOutcome: "Scaling with blobs", displayName: "" },
            { parentOutcomeIndex: "1", parentOutcome: "Privacy pools", displayName: null },
          ],
        }
      : { SessionCounter: [{ count: 1 }], Session: [ROW] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionBrowser />
    </QueryClientProvider>,
  );
}

const card = () => screen.getByRole("link", { name: /Resolved past talks/ });

beforeEach(() => {
  vi.mocked(fetchGraphql).mockReset();
  vi.mocked(fetchSessionResolution).mockReset();
});

describe("the homepage A3 names a resolved session's winning options", () => {
  it("lists the options its parent selected on the card, by outcome index, and not the others", async () => {
    answer([0, 2]);

    await waitFor(() => expect(card()).toHaveTextContent("Scaling with blobs, Account abstraction today"));
    expect(card()).not.toHaveTextContent("Privacy pools");
    expect(card()).not.toHaveTextContent("talk-2");
  });

  it("keeps the option count on a resolved card with no winner to name", async () => {
    answer([]);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Resolved" })).toBeInTheDocument());
    expect(card()).toHaveTextContent("3 Talks");
    expect(vi.mocked(fetchGraphql).mock.calls.some(([document]) => queryName(document) === "SessionOptionNames")).toBe(
      false,
    );
  });
});

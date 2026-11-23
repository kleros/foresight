import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
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

/** Talks 0 and 2 of three won. */
const RESOLVED: ParentResolution = {
  resolved: true,
  invalid: false,
  winningOutcomes: [0, 2],
  payoutNumerators: [1n, 0n, 1n, 0n],
  payoutDenominator: 2n,
};
const NAMES = ["Scaling with blobs", "Privacy pools", "Account abstraction today"];

const ROW = {
  ...sessionColumns,
  id: "11",
  parentMarket: `0x${"11".padStart(40, "0")}`,
  title: "Devcon talks",
  itemNamePlural: "Talks",
  outcomeCount: "3",
  keyword: "devcon talks",
};

const queryName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

beforeEach(() => {
  graphqlMock.mockReset();
  resolutionMock.mockReset();
  resolutionMock.mockResolvedValue({ parent: RESOLVED, children: {} });
  graphqlMock.mockImplementation(async (document, variables) => {
    if (queryName(document) !== "SessionWinners") return { SessionCounter: [{ count: 1 }], Session: [ROW] };
    const indexes = (variables as { indexes: string[] }).indexes;
    return {
      Session: [
        {
          outcomes: NAMES.map((name) => name.toLowerCase()),
          children: indexes.map((index) => ({
            parentOutcomeIndex: index,
            parentOutcome: NAMES[Number(index)]!.toLowerCase(),
            displayName: NAMES[Number(index)],
          })),
        },
      ],
    };
  });
});

describe("SessionBrowser lists a resolved session's winning options on its card", () => {
  it("names the winners the parent paid, and no losing option", async () => {
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <SessionBrowser />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "Resolved" }, { timeout: 4_000 });
    const card = screen.getByRole("link", { name: /Devcon talks/ });
    await waitFor(() => expect(card).toHaveTextContent("Scaling with blobs, Account abstraction today"));
    expect(card).not.toHaveTextContent("Privacy pools");
    const winnersRead = graphqlMock.mock.calls.find(([document]) => queryName(document) === "SessionWinners");
    expect(winnersRead?.[1]).toEqual({ sessionId: "11", indexes: ["0", "2"] });
  });
});

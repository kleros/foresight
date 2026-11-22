import type { ReactNode } from "react";

import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeQueryClient } from "@/lib/query";

import { fetchSessionResolution, type ParentResolution } from "../getSessionResolution";
import { useSessionResolution } from "../useSessionResolution";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("../getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));

const fetchMock = vi.mocked(fetchSessionResolution);

const READ = {
  sessionFactory: "0xfac7000000000000000000000000000000000001" as Address,
  sessionId: 7n,
  childMarkets: [] as Address[],
};
const RESOLVED: ParentResolution = {
  resolved: true,
  invalid: false,
  winningOutcomes: [0],
  payoutNumerators: [1n, 0n],
  payoutDenominator: 1n,
};

/** Parent-only reads answer from `parents` in order, the last one repeating. */
function answer(parents: Array<ParentResolution | Error>) {
  let next = 0;
  fetchMock.mockImplementation(async (_client, request) => {
    if (request.parentOutcomes?.length !== 0) return { parent: { resolved: false }, children: {} };
    const reply = parents[Math.min(next++, parents.length - 1)]!;
    if (reply instanceof Error) throw reply;
    return { parent: reply, children: {} };
  });
}

function mount(read: typeof READ | undefined) {
  const client = makeQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSessionResolution(read), { wrapper });
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("useSessionResolution's recheckParent", () => {
  it("reads the parent again and answers with the fresh read, which the page then shows", async () => {
    answer([{ resolved: false }, RESOLVED]);
    const { result } = mount(READ);
    await waitFor(() => expect(result.current.parent).toEqual({ resolved: false }));

    let fresh: ParentResolution | Error | undefined;
    await act(async () => {
      fresh = await result.current.recheckParent!();
    });

    expect(fresh).toEqual(RESOLVED);
    await waitFor(() => expect(result.current.parent).toEqual(RESOLVED));
  });

  it("answers with the Error a failed re-read gave", async () => {
    answer([{ resolved: false }, new Error("HTTP request failed")]);
    const { result } = mount(READ);
    await waitFor(() => expect(result.current.parent).toEqual({ resolved: false }));

    let fresh: ParentResolution | Error | undefined;
    await act(async () => {
      fresh = await result.current.recheckParent!();
    });

    expect(fresh).toBeInstanceOf(Error);
    await waitFor(() => expect(result.current.parent).toBeInstanceOf(Error));
  });

  it("is absent until the session is known", () => {
    const { result } = mount(undefined);

    expect(result.current.recheckParent).toBeUndefined();
  });
});

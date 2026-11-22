import type { ReactNode } from "react";

import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeQueryClient, STALE_TIME } from "@/lib/query";

import { fetchSessionResolution, type SessionResolutionRequest } from "../getSessionResolution";
import { useParentResolutions, useSessionResolution } from "../useSessionResolution";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("../getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));

const fetchMock = vi.mocked(fetchSessionResolution);

const READ = {
  sessionFactory: "0xfac7000000000000000000000000000000000001" as Address,
  sessionId: 7n,
  childMarkets: ["0xc100000000000000000000000000000000000001"] as Address[],
};

const isParentOnly = (request: SessionResolutionRequest) => request.parentOutcomes?.length === 0;
const parentCalls = () => fetchMock.mock.calls.filter(([, request]) => isParentOnly(request)).length;
const childCalls = () => fetchMock.mock.calls.filter(([, request]) => !isParentOnly(request)).length;

function wrapper() {
  const client = makeQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ({ parent: { resolved: false }, children: {} }));
});

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

describe("useSessionResolution re-reads an unresolved parent every 30 s", () => {
  it("reads once before 30 s and again just after", async () => {
    renderHook(() => useSessionResolution(READ), { wrapper: wrapper() });

    await advance(1);
    expect(parentCalls()).toBe(1);

    await advance(29_000);
    expect(parentCalls()).toBe(1);

    await advance(1_500);
    expect(parentCalls()).toBe(2);

    await advance(30_000);
    expect(parentCalls()).toBe(3);
  });

  it("paces the homepage's per-session reads the same way", async () => {
    renderHook(() => useParentResolutions([READ]), { wrapper: wrapper() });

    await advance(1);
    expect(parentCalls()).toBe(1);

    await advance(29_000);
    expect(parentCalls()).toBe(1);

    await advance(1_500);
    expect(parentCalls()).toBe(2);
  });

  it("gives the homepage the Error of a failed re-read in place of the cached answer", async () => {
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      if (calls++ > 0) throw new Error("HTTP request failed");
      return { parent: { resolved: false }, children: {} };
    });
    const { result } = renderHook(() => useParentResolutions([READ]), { wrapper: wrapper() });

    await advance(1);
    expect(result.current[0]).toEqual({ resolved: false });

    await advance(30_500);
    expect(result.current[0]).toBeInstanceOf(Error);
  });
});

describe("useSessionResolution does not re-read on focus", () => {
  it("leaves stale parent and child reads alone when the window regains focus", async () => {
    renderHook(() => useSessionResolution(READ), { wrapper: wrapper() });
    await advance(1);
    // past the stale time, so a focus refetch would fire, and short of the 30 s re-read
    await advance(STALE_TIME.live + 5_000);
    const before = { parent: parentCalls(), children: childCalls() };

    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));
    await advance(1);

    expect({ parent: parentCalls(), children: childCalls() }).toEqual(before);
  });
});

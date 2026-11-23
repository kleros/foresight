import type { ReactNode } from "react";

import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeQueryClient } from "@/lib/query";

import { fetchSessionResolution, type ParentResolution, type SessionResolutionRequest } from "../getSessionResolution";
import {
  sessionKey,
  sessionResolutionKeys,
  useParentResolutions,
  useSessionResolution,
  type SessionResolutionRead,
} from "../useSessionResolution";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("../getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));

const fetchMock = vi.mocked(fetchSessionResolution);

const FACTORY = "0xFAC7000000000000000000000000000000000001" as Address;
const A: Address = "0xC100000000000000000000000000000000000001";
const B: Address = "0xC200000000000000000000000000000000000002";
const C: Address = "0xC300000000000000000000000000000000000003";

const UNRESOLVED: ParentResolution = { resolved: false };
const RESOLVED: ParentResolution = {
  resolved: true,
  invalid: false,
  winningOutcomes: [0],
  payoutNumerators: [1n, 0n, 0n],
  payoutDenominator: 1n,
};

const isParentOnly = (request: SessionResolutionRequest) => request.parentOutcomes?.length === 0;
const parentCalls = () => fetchMock.mock.calls.filter(([, request]) => isParentOnly(request));
const childCalls = () => fetchMock.mock.calls.filter(([, request]) => !isParentOnly(request));

const read = (overrides: Partial<SessionResolutionRead> = {}): SessionResolutionRead => ({
  sessionFactory: FACTORY,
  sessionId: 7n,
  childMarkets: [A, B],
  ...overrides,
});

const childAnswer = { 0: { deployed: true as const, market: A, resolved: false as const } };

function mount(initial: SessionResolutionRead = read(), client: QueryClient = makeQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(({ at }: { at: SessionResolutionRead }) => useSessionResolution(at), {
    wrapper,
    initialProps: { at: initial },
  });
  return { ...hook, client };
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_client, request) => ({
    parent: UNRESOLVED,
    children: isParentOnly(request) ? {} : childAnswer,
  }));
});

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

describe("useSessionResolution's re-read of an open page", () => {
  it("re-reads an unresolved parent at 30 s, not before", async () => {
    mount();
    await advance(1);
    expect(parentCalls()).toHaveLength(1);

    await advance(28_000);
    expect(parentCalls()).toHaveLength(1);

    await advance(2_500);
    expect(parentCalls()).toHaveLength(2);
  });

  it("re-reads a failed parent after 10 s, sooner than an unresolved one", async () => {
    fetchMock.mockRejectedValue(new Error("HTTP request failed"));
    const { result } = mount();
    await advance(1);
    expect(result.current.parent).toBeInstanceOf(Error);
    const after = parentCalls().length;

    await advance(9_000);
    expect(parentCalls()).toHaveLength(after);
    await advance(1_500);
    expect(parentCalls()).toHaveLength(after + 1);
  });

  it("recheckParent reads once more when the first read fails, and returns the second answer", async () => {
    let calls = 0;
    fetchMock.mockImplementation(async (_client, request) => {
      if (isParentOnly(request) && ++calls === 2) throw new Error("HTTP request failed");
      return { parent: UNRESOLVED, children: isParentOnly(request) ? {} : childAnswer };
    });
    const { result } = mount();
    await advance(1);
    const before = parentCalls().length;

    const answer = await act(() => result.current.recheckParent!());

    expect(answer).toEqual(UNRESOLVED);
    expect(parentCalls()).toHaveLength(before + 2);
  });

  it("recheckParent returns the Error when both reads fail", async () => {
    const { result } = mount();
    await advance(1);
    fetchMock.mockRejectedValue(new Error("HTTP request failed"));

    const answer = await act(() => result.current.recheckParent!());

    expect(answer).toBeInstanceOf(Error);
  });

  it("reads a resolved parent no more", async () => {
    fetchMock.mockImplementation(async (_client, request) => ({
      parent: RESOLVED,
      children: isParentOnly(request) ? {} : childAnswer,
    }));
    mount();
    await advance(1);

    await advance(120_000);
    expect(parentCalls()).toHaveLength(1);
  });

  it("does not re-read a stale answer when the window regains focus, on a client that otherwise would", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, retry: false } } });
    mount(read(), client);
    await advance(1);
    // past the answer's stale time, short of the 30 s re-read
    await advance(15_000);
    const before = fetchMock.mock.calls.length;

    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));
    await advance(1);

    expect(fetchMock.mock.calls.length).toBe(before);
  });
});

describe("useSessionResolution's child read", () => {
  it("shows a failed child re-read over the children it had read", async () => {
    let failing = false;
    fetchMock.mockImplementation(async (_client, request) => {
      if (!isParentOnly(request) && failing) throw new Error("child market read reverted");
      return { parent: UNRESOLVED, children: isParentOnly(request) ? {} : childAnswer };
    });
    const { result } = mount();
    await advance(1);
    expect(result.current.children).toEqual(childAnswer);

    failing = true;
    await advance(30_000);

    expect(result.current.children).toBeInstanceOf(Error);
    expect(result.current.parent).toEqual(UNRESOLVED);
  });

  it("is keyed on the session's child markets, lower-cased", async () => {
    const { client } = mount();
    await advance(1);

    const keys = client
      .getQueryCache()
      .findAll({ queryKey: [...sessionResolutionKeys.all, "children"] })
      .map((query) => query.queryKey);
    expect(keys).toEqual([
      ["session-resolution", "children", FACTORY.toLowerCase(), "7", [A, B].map((m) => m.toLowerCase())],
    ]);
  });

  it("reads the children again when one child market is swapped for another", async () => {
    const { rerender } = mount(read({ childMarkets: [A, B] }));
    await advance(1);
    const before = childCalls().length;

    rerender({ at: read({ childMarkets: [A, C] }) });
    await advance(1);

    expect(childCalls().length).toBeGreaterThan(before);
  });
});

describe("useSessionResolution's recheck", () => {
  it("reads the parent again past a cached answer and returns what it read", async () => {
    const { result } = mount();
    await advance(1);
    expect(result.current.parent).toEqual(UNRESOLVED);
    fetchMock.mockImplementation(async (_client, request) => ({
      parent: RESOLVED,
      children: isParentOnly(request) ? {} : childAnswer,
    }));

    let fresh: ParentResolution | Error | undefined;
    await act(async () => {
      fresh = await result.current.recheckParent!();
    });

    expect(fresh).toEqual(RESOLVED);
    expect(parentCalls()).toHaveLength(2);
    expect(parentCalls().every(([, request]) => request.sessionId === 7n)).toBe(true);
    await advance(1);
    expect(result.current.parent).toEqual(RESOLVED);
  });

  it("returns the Error a failed recheck read with", async () => {
    const { result } = mount();
    await advance(1);
    fetchMock.mockRejectedValue(new Error("HTTP request failed"));

    let fresh: ParentResolution | Error | undefined;
    await act(async () => {
      fresh = await result.current.recheckParent!();
    });

    expect(fresh).toBeInstanceOf(Error);
  });
});

describe("useParentResolutions", () => {
  it("answers each session in order, and leaves a session it was not given unread", async () => {
    fetchMock.mockImplementation(async (_client, request) => {
      if (request.sessionId === 2n) throw new Error("HTTP request failed");
      return { parent: request.sessionId === 1n ? RESOLVED : UNRESOLVED, children: {} };
    });
    const client = makeQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const sessions = [sessionKey("1", FACTORY), undefined, sessionKey("2", FACTORY), sessionKey("3", FACTORY)];
    const { result } = renderHook(() => useParentResolutions(sessions), { wrapper });
    await advance(1);

    expect(result.current[0]).toEqual(RESOLVED);
    expect(result.current[1]).toBeUndefined();
    expect(result.current[2]).toBeInstanceOf(Error);
    expect(result.current[3]).toEqual(UNRESOLVED);
    expect(fetchMock.mock.calls.every(([, request]) => request.parentOutcomes?.length === 0)).toBe(true);
  });
});

describe("sessionKey", () => {
  it("numbers a factory session by its id", () => {
    expect(sessionKey("12", FACTORY)).toEqual({ sessionFactory: FACTORY, sessionId: 12n });
  });

  it.each(["legacy-movies-s1", "", "1e3", "-1"])("names no factory session for the id %j", (id) => {
    expect(sessionKey(id, FACTORY)).toBeUndefined();
  });

  it("names no session without a factory", () => {
    expect(sessionKey("12", null)).toBeUndefined();
  });
});

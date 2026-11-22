import type { ReactNode } from "react";

import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeQueryClient } from "@/lib/query";

import {
  fetchSessionResolution,
  type ParentResolution,
  type SessionResolution,
  type SessionResolutionRequest,
} from "../getSessionResolution";
import { useSessionResolution, type SessionResolutionRead } from "../useSessionResolution";

/**
 * useSessionResolution(read) → { parent, children }: each the read's value, the Error its latest attempt failed
 * with, or undefined while unread. It reads through child 2's fetchSessionResolution, mocked here.
 */

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("../getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));

const fetchMock = vi.mocked(fetchSessionResolution);

const FACTORY = "0xfac7000000000000000000000000000000000001" as Address;
const CHILDREN = [
  "0xc100000000000000000000000000000000000001",
  "0xc200000000000000000000000000000000000002",
] as Address[];

const UNRESOLVED: ParentResolution = { resolved: false };
const RESOLVED: ParentResolution = {
  resolved: true,
  invalid: false,
  winningOutcomes: [1],
  payoutNumerators: [0n, 1n, 0n],
  payoutDenominator: 1n,
};

type ParentAnswer = ParentResolution | Error;

/** A request that reads no child: the parent's own read. */
const isParentOnly = (request: SessionResolutionRequest) => request.parentOutcomes?.length === 0;
const parentCalls = () => fetchMock.mock.calls.filter(([, request]) => isParentOnly(request));
const childCalls = () => fetchMock.mock.calls.filter(([, request]) => !isParentOnly(request));

const childrenOf = (request: SessionResolutionRequest): SessionResolution["children"] =>
  Object.fromEntries(
    (request.parentOutcomes ?? CHILDREN.map((_, index) => index)).map((index) => [
      index,
      { deployed: true, market: CHILDREN[index] ?? CHILDREN[0]!, resolved: false },
    ]),
  );

/**
 * Answers parent-only reads from `parent` in order, the last one repeating. Reads that include children answer
 * from their own pass over `parent`, and throw `children` when it is an Error.
 */
function answer(parent: ParentAnswer[], children: "ok" | Error = "ok") {
  const next = { own: 0, combined: 0 };
  fetchMock.mockImplementation(async (_client, request) => {
    const own = isParentOnly(request);
    if (!own && children instanceof Error) throw children;
    const pass = own ? "own" : "combined";
    const reply = parent[Math.min(next[pass]++, parent.length - 1)]!;
    if (reply instanceof Error) throw reply;
    return { parent: reply, children: own ? {} : childrenOf(request) };
  });
}

const read = (overrides: Partial<SessionResolutionRead> = {}): SessionResolutionRead => ({
  sessionFactory: FACTORY,
  sessionId: 7n,
  childMarkets: CHILDREN,
  ...overrides,
});

type Shown = "unread" | "error" | "unresolved" | "resolved";
const shown = (parent: ParentResolution | Error | undefined): Shown =>
  parent === undefined ? "unread" : parent instanceof Error ? "error" : parent.resolved ? "resolved" : "unresolved";

/** Each distinct parent state the hook rendered, in order. */
function mount(initial: SessionResolutionRead = read()) {
  const client = makeQueryClient();
  const history: Shown[] = [];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ at }: { at: SessionResolutionRead }) => {
      const state = useSessionResolution(at);
      const now = shown(state.parent);
      if (history.at(-1) !== now) history.push(now);
      return state;
    },
    { wrapper, initialProps: { at: initial } },
  );
  return { ...hook, history, client };
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

describe("A9 a failed read is shown, never hidden behind a cached answer", () => {
  it("shows a failure, then the retry's success, in that order, without a manual refetch", async () => {
    answer([new Error("HTTP request failed"), RESOLVED]);
    const { result, history } = mount();

    await advance(0);
    await advance(1);
    expect(shown(result.current.parent)).toBe("error");

    await advance(60_000);

    expect(shown(result.current.parent)).toBe("resolved");
    const seen = history.filter((state) => state !== "unread");
    expect(seen.indexOf("error")).toBeGreaterThanOrEqual(0);
    expect(seen.indexOf("error")).toBeLessThan(seen.indexOf("resolved"));
  });

  it("shows the failure of a refetch over a cached resolved: false, then the success after it", async () => {
    answer([UNRESOLVED, new Error("HTTP request failed"), new Error("HTTP request failed"), RESOLVED]);
    const { result, history } = mount();

    await advance(1);
    expect(shown(result.current.parent)).toBe("unresolved");

    for (let elapsed = 0; elapsed < 120_000 && shown(result.current.parent) !== "error"; elapsed += 1_000) {
      await advance(1_000);
    }
    expect(shown(result.current.parent)).toBe("error");

    await advance(120_000);
    expect(shown(result.current.parent)).toBe("resolved");
    expect(history.filter((state) => state !== "unread")).toEqual(["unresolved", "error", "resolved"]);
  });
});

describe("A9 re-reading an open page", () => {
  it("re-reads an unresolved parent about every 30 s", async () => {
    answer([UNRESOLVED]);
    mount();

    await advance(1);
    expect(parentCalls()).toHaveLength(1);

    await advance(10_000);
    expect(parentCalls()).toHaveLength(1);

    await advance(25_000);
    expect(parentCalls().length).toBeGreaterThanOrEqual(2);

    await advance(30_000);
    expect(parentCalls().length).toBeGreaterThanOrEqual(3);
  });

  it("does not re-read when the window regains focus", async () => {
    answer([UNRESOLVED]);
    mount();
    await advance(1);
    const before = fetchMock.mock.calls.length;

    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));
    await advance(1);

    expect(fetchMock.mock.calls.length).toBe(before);
  });
});

describe("A9 what each read is keyed on", () => {
  it("reads the parent apart from the children, so a failed child read leaves the parent's answer", async () => {
    answer([RESOLVED], new Error("child market read reverted"));
    const { result } = mount();

    await advance(1);
    await advance(10_000);

    expect(result.current.parent).toEqual(RESOLVED);
  });

  it("reads the children again when the session's child markets change", async () => {
    answer([UNRESOLVED]);
    const { rerender } = mount(read({ childMarkets: CHILDREN.slice(0, 1) }));
    await advance(1);
    const before = childCalls().length;
    expect(before).toBeGreaterThanOrEqual(1);

    rerender({ at: read({ childMarkets: CHILDREN }) });
    await advance(1);

    expect(childCalls().length).toBeGreaterThan(before);
  });

  it("keeps two sessions of one factory apart", async () => {
    fetchMock.mockImplementation(async (_client, request) => ({
      parent: request.sessionId === 2n ? RESOLVED : UNRESOLVED,
      children: isParentOnly(request) ? {} : childrenOf(request),
    }));
    const client = makeQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const one = renderHook(() => useSessionResolution(read({ sessionId: 1n })), { wrapper });
    const two = renderHook(() => useSessionResolution(read({ sessionId: 2n })), { wrapper });
    await advance(1);

    expect(shown(one.result.current.parent)).toBe("unresolved");
    expect(shown(two.result.current.parent)).toBe("resolved");
  });

  it("reads nothing until the session is known", async () => {
    answer([UNRESOLVED]);
    const client = makeQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useSessionResolution(undefined), { wrapper });
    await advance(1_000);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.parent).toBeUndefined();
  });
});

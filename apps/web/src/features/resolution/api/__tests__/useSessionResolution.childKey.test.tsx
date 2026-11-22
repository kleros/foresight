import type { ReactNode } from "react";

import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeQueryClient } from "@/lib/query";

import { fetchSessionResolution, type SessionResolutionRequest } from "../getSessionResolution";
import { useSessionResolution, type SessionResolutionRead } from "../useSessionResolution";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("../getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));

const fetchMock = vi.mocked(fetchSessionResolution);

const [A, B, C] = ["0xc1", "0xc2", "0xc3"].map((head) => head.padEnd(42, "a") as Address) as [
  Address,
  Address,
  Address,
];

const read = (childMarkets: Address[]): SessionResolutionRead => ({
  sessionFactory: "0xfac7000000000000000000000000000000000001",
  sessionId: 7n,
  childMarkets,
});

const isParentOnly = (request: SessionResolutionRequest) => request.parentOutcomes?.length === 0;
const childCalls = () => fetchMock.mock.calls.filter(([, request]) => !isParentOnly(request)).length;

function mount(initial: SessionResolutionRead) {
  const client = makeQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(({ at }: { at: SessionResolutionRead }) => useSessionResolution(at), {
    wrapper,
    initialProps: { at: initial },
  });
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ({ parent: { resolved: false }, children: {} }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("A9 the children read is keyed on the child markets themselves", () => {
  it.each([
    ["last", [A, C]],
    ["first", [C, B]],
  ])("reads the children again when the %s child market is swapped, the count unchanged", async (_at, next) => {
    const { rerender } = mount(read([A, B]));
    await advance(1);
    const before = childCalls();
    expect(before).toBe(1);

    rerender({ at: read(next) });
    await advance(1);

    expect(childCalls()).toBe(before + 1);
  });

  it("does not read them again for the same child markets written in another case", async () => {
    const { rerender } = mount(read([A, B]));
    await advance(1);
    const before = childCalls();

    const upper = (market: Address) => market.replace(/a/g, "A") as Address;
    rerender({ at: read([upper(A), upper(B)]) });
    await advance(1);

    expect(childCalls()).toBe(before);
  });
});

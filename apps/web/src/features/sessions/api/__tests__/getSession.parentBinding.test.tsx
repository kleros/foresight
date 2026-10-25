import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { sessionChildRow, sessionDetailColumns } from "../../utils/__tests__/fixtures";
import { useSession } from "../getSession";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://example.test/ipfs" }));
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));

it("rejects a response for another decision before caching it under the requested URL", async () => {
  const requested = "0x1111111111111111111111111111111111111111";
  vi.mocked(fetchGraphql).mockResolvedValue({
    Session: [
      {
        ...sessionDetailColumns,
        parentMarket: "0x2222222222222222222222222222222222222222",
        children: [sessionChildRow()],
      },
    ],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useSession(requested), { wrapper });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.data).toBeUndefined();
  expect(result.current.error?.message).toBe("This session does not match the requested decision.");
  expect(vi.mocked(fetchGraphql).mock.calls.at(-1)?.[1]).toEqual({ parentMarket: requested });
});

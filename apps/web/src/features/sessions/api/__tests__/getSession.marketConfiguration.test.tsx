import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { estimateToPriceWad } from "@/utils/optionPrice";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { sessionChildRow, sessionDetailColumns } from "../../utils/__tests__/fixtures";
import { useSession } from "../getSession";
import { SDAI } from "./support/verifiedSession";

vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
vi.mock("@/lib/web3/public-client", async () => ({
  publicClient: (await import("./support/verifiedSession")).verifiedClient,
}));
vi.mock("@/config/chains", () => ({ DEFAULT_CHAIN_ID: 100 }));
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://example.test/ipfs" }));
afterEach(() => vi.clearAllMocks());

const original = {
  ...sessionDetailColumns,
  collateralToken: SDAI,
  children: [sessionChildRow({ parentOutcomeIndex: "0" })],
};
function session(row = original) {
  vi.mocked(fetchGraphql).mockResolvedValue({ Session: [row] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSession(row.parentMarket), { wrapper });
}

it.each([
  { upperBound: String(5000n * 10n ** 18n) },
  { upToken: "0x1111111111111111111111111111111111111111" },
  { underlyingToken: "0x1111111111111111111111111111111111111111" },
  { id: "0x1111111111111111111111111111111111111111" },
  { parentOutcomeIndex: "1" },
])("rejects changed signing configuration with unchanged display labels: %j", async (change) => {
  const { result } = session({ ...original, children: [{ ...original.children[0]!, ...change }] });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.data).toBeUndefined();
});

it("uses verified bounds and wrapped outcomes for the displayed scale and target price", async () => {
  const { result } = session();
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  const detail = result.current.data!;
  expect(detail.options[0]).toMatchObject({ lowerBound: 0, upperBound: 500, upToken: original.children[0]!.upToken });
  expect(estimateToPriceWad(125, detail.options[0]!)).toBe(250000000000000000n);
});

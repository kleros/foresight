import type { ReactNode } from "react";

import { act, screen, waitFor } from "@testing-library/react";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { owner, sortPair } from "@/features/liquidity/api/__tests__/support/chain";
import { fullRange } from "@/features/liquidity/flow/__tests__/support/session";
import { useEstimateStore } from "@/features/predict/stores/estimateStore";

import { fetchGraphql } from "@/lib/graphql/batcher";

import {
  addControls,
  createWorld,
  PAST_CLOSE,
  renderMarketPage,
  sessionLoaded,
  sessionRow,
  WAD,
  type World,
} from "../support";

const current = vi.hoisted(() => ({
  world: undefined as unknown as { client: unknown },
  account: { address: undefined as string | undefined, chainId: 100, isConnected: false, status: "disconnected" },
}));
vi.mock("@/lib/web3/public-client", () => ({
  get publicClient() {
    return current.world.client;
  },
}));
vi.mock("@/config/chains", async (importOriginal) => {
  const { gnosis } = await import("viem/chains");
  return {
    ...(await importOriginal<typeof import("@/config/chains")>()),
    DEFAULT_CHAIN_ID: 100,
    DEFAULT_CHAIN: gnosis,
  };
});
vi.mock("@/features/sessions/api/verifySession", () => ({
  verifySession: async (_client: unknown, _chain: number, row: unknown) => row,
}));
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://cdn.example.link/ipfs" }));
vi.mock("@/features/trade-executor/components/TradeWallet/TradeWallet", () => ({ TradeWallet: () => null }));
vi.mock("@/app/market/[parentMarket]/_components/useOptionPositions", () => ({ useOptionPositions: () => ({}) }));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => current.account,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
/* The chart is canvas; this stands in for it and shows the end time it was handed. */
vi.mock("@/features/sessions/components/SessionChart", () => ({
  SessionChart: ({ endTime }: { endTime: number | null }) => <p data-testid="chart-end">{String(endTime)}</p>,
}));

const fetchMock = vi.mocked(fetchGraphql);

vi.setConfig({ testTimeout: 20_000 });

const Q96 = 2n ** 96n;
const { tickLower, tickUpper } = fullRange(60);
/** Half an underlying per UP token: the middle of each branch's range. */
const HALF = (WAD / 2n).toString();

const queryName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

/** Branch 0's UP pool is live and the wallet holds a position in it. */
function liquid(): World {
  const world = createWorld();
  const [first] = world.branches as [World["branches"][0]];
  world.setPool(first.upToken, first.outcome, { sqrtPriceX96: Q96, liquidity: 10n * WAD, tickSpacing: 60 });
  const [token0, token1] = sortPair(first.upToken, first.outcome);
  world.holdPosition(owner, { tokenId: 7n, token0, token1, tickLower, tickUpper, liquidity: WAD });
  return world;
}

/** Branch 0's UP pool is initialized empty and the wallet holds a position in it above the pool's tick. */
function drained(): World {
  const world = createWorld();
  const [first] = world.branches as [World["branches"][0]];
  world.setPool(first.upToken, first.outcome, { sqrtPriceX96: Q96, liquidity: 0n, tickSpacing: 60 });
  const [token0, token1] = sortPair(first.upToken, first.outcome);
  world.holdPosition(owner, { tokenId: 11n, token0, token1, tickLower: 600, tickUpper: 1_200, liquidity: WAD });
  return world;
}

/** The session row past its resolution date, and a chart whose every UP pool last traded at half. */
function show(world: World) {
  current.world = world;
  fetchMock.mockImplementation((async (document: DocumentNode) => {
    if (queryName(document) === "SessionDetail") return { Session: [sessionRow(world, PAST_CLOSE)] };
    if (queryName(document) === "SessionChart") {
      return {
        Pool: world.branches.map((branch, index) => ({
          id: `0x${String(index + 1).padStart(40, "0")}`,
          childMarket_id: branch.childMarket.toLowerCase(),
          underlyingPerOutcome: HALF,
          updatedAt: PAST_CLOSE,
          swaps: [],
        })),
      };
    }
    return { Prediction: [], directSwaps: [], senderlessSwaps: [], Pool: [] };
  }) as never);
  renderMarketPage(world);
  return sessionLoaded();
}

const summary = () => screen.getByTestId("liquidity-summary");
const predictButton = () => screen.getByRole("button", { name: /^Predict (\d+ )?estimates?$/ });
const disabled = (element: HTMLElement) =>
  element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";

beforeEach(() => {
  fetchMock.mockReset();
  useEstimateStore.setState({ estimates: {} });
  current.account = { address: owner, chainId: 100, isConnected: true, status: "connected" };
  window.history.replaceState(null, "", "/");
});

describe("the market page past the resolution date", () => {
  it("keeps the session trading while a pool holds liquidity: Predict on, no Add liquidity, no countdown", async () => {
    const world = liquid();
    await show(world);
    // the position is counted once the pools are read
    await waitFor(() => expect(summary()).toHaveTextContent(/^1 position\b/), { timeout: 5000 });

    const [first] = world.branches as [World["branches"][0]];
    act(() => useEstimateStore.getState().setEstimate(world.parentMarket, first.childMarket, 400));

    await waitFor(() => expect(disabled(predictButton())).toBe(false), { timeout: 5000 });
    expect(screen.getByText("Trading")).toBeInTheDocument();
    expect(screen.queryByText("Trading has closed.")).toBeNull();
    expect(screen.getByText("Resolution opens:")).toBeInTheDocument();
    expect(screen.queryByText("Countdown:")).toBeNull();
    expect(addControls()).toEqual([]);
    expect(screen.getByTestId("chart-end")).toHaveTextContent("null");
  });

  it("closes the session once its pools are read with no liquidity, the chart ending at the date", async () => {
    await show(drained());

    await waitFor(() => expect(screen.getAllByText("Trading has closed.").length).toBeGreaterThan(0), {
      timeout: 5000,
    });
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.queryByText("Countdown:")).toBeNull();
    expect(addControls()).toEqual([]);
    expect(screen.getByTestId("chart-end")).toHaveTextContent(PAST_CLOSE);
  });
});

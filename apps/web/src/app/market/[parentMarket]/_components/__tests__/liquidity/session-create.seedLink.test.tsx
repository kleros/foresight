import type { ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { owner } from "@/features/liquidity/api/__tests__/support/chain";
import { draftAssessment } from "@/features/session-create/__tests__/support/drafts";
import { DeployStep } from "@/features/session-create/components/DeployStep";
import type { SessionDeployDriver, SessionDeployProgress } from "@/features/session-create/deploy/types";
import { batchCount, deployMode } from "@/features/session-create/flow/params";
import { useDraftStore } from "@/features/session-create/stores/draftStore";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { createWorld, graphqlFor, liquidityDialog, renderMarketPage, sessionLoaded, TRADING_CLOSE } from "./support";

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

const fetchMock = vi.mocked(fetchGraphql);

// the page reads the session, then the pools, then the positions, each a round trip through the fake chain
vi.setConfig({ testTimeout: 20_000 });

const OUTCOMES = 2;

function stubDriver(): SessionDeployDriver {
  return {
    start: vi.fn(),
    recover: vi.fn(),
    continueRecovered: vi.fn(),
    retry: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
    getProgress: () => deployed(""),
    subscribe: () => () => {},
  };
}

const deployed = (parentMarket: string): SessionDeployProgress => ({
  stage: "complete",
  mode: deployMode(OUTCOMES),
  batch: 1,
  batches: batchCount(OUTCOMES),
  parent: { state: "success" },
  children: Array.from({ length: OUTCOMES }, () => ({ state: "success" as const })),
  batchSteps: [],
  parentMarket,
});

/** `decisionDate` is the session's resolution date, `parent.openingTime`. */
function renderDeployed(parentMarket: string, decisionDate = "2099-09-20") {
  const store = () => useDraftStore.getState();
  store().resetDraft();
  store().setDraftField("decisionDate", decisionDate);
  while (store().draft.outcomes.length < OUTCOMES) store().addOutcome();
  return render(
    <DeployStep
      assessment={draftAssessment()}
      active
      walletConnected
      walletSlot={null}
      signedIn
      signInSlot={null}
      progress={deployed(parentMarket)}
      driver={stubDriver()}
      gateway="https://gateway.test/ipfs"
    />,
  );
}

const seedLink = () => screen.getByRole("link", { name: "Seed liquidity" });

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  current.account = { address: owner, chainId: 100, isConnected: true, status: "connected" };
  window.history.replaceState(null, "", "/");
});

describe("DeployStep's Seed liquidity, followed", () => {
  it("opens the market page with the liquidity popup open", async () => {
    const world = createWorld();
    const { unmount } = renderDeployed(world.parentMarket);
    const href = seedLink().getAttribute("href") ?? "";
    unmount();

    window.history.pushState(null, "", href);
    current.world = world;
    fetchMock.mockImplementation(graphqlFor(world, TRADING_CLOSE) as never);
    renderMarketPage(world);
    await sessionLoaded();

    expect(await liquidityDialog()).toBeInTheDocument();
  });
});

describe("DeployStep's Seed liquidity after the resolution date", () => {
  it("is disabled with the resolution date as its reason, and links nowhere", () => {
    renderDeployed(createWorld().parentMarket, "2025-09-03");

    expect(screen.queryByRole("link", { name: "Seed liquidity" })).toBeNull();
    const seed = screen.getByRole("button", { name: "Seed liquidity" });
    expect(seed).toBeDisabled();
    expect(seed).toHaveAccessibleDescription(/resolution opens/i);
  });
});

describe("DeployStep's Seed liquidity at the session's close", () => {
  // the draft's decision time defaults to 12:00 UTC
  const CLOSE = Date.UTC(2030, 0, 1, 12);

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is a link one millisecond before the close", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(CLOSE - 1);
    renderDeployed(createWorld().parentMarket, "2030-01-01");

    expect(seedLink()).toBeInTheDocument();
  });

  it("is disabled at the close itself", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(CLOSE);
    renderDeployed(createWorld().parentMarket, "2030-01-01");

    expect(screen.queryByRole("link", { name: "Seed liquidity" })).toBeNull();
    expect(screen.getByRole("button", { name: "Seed liquidity" })).toBeDisabled();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseEther, parseUnits } from "viem";
import { describe, expect, it } from "vitest";

import type { PoolBalances, SessionStats, SessionStatus } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { type SessionDetailRow, toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { addresses, GATEWAY } from "@/testing/fixtures";

import { SessionHeader } from "../SessionHeader";

function row(overrides: Partial<SessionDetailRow> = {}): SessionDetailRow {
  return { ...sessionDetailColumns, children: [sessionChildRow()], ...overrides };
}

// Volume expectation reads "92,000.5" because that is the string parseEther is given, regrouped.
const stats: SessionStats = {
  traders: 148,
  volumeUnderlying: parseEther("92000.5"),
  volumeOutcome: parseEther("100"),
  pools: [
    {
      id: addresses.childMarkets[1]!,
      market: addresses.childMarkets[0]!,
      side: "UP",
      outcomeToken: addresses.upToken,
      underlyingToken: addresses.underlyingToken,
      underlyingPerOutcome: null,
      volumeUnderlying: parseEther("92000.5"),
      volumeOutcome: parseEther("100"),
    },
  ],
};

function renderHeader({ overrides = {}, status = "trading" as SessionStatus } = {}) {
  return render(
    <SessionHeader
      session={toSessionDetail(row(overrides), GATEWAY)}
      status={status}
      stats={stats}
      statsPending={false}
      poolBalances={undefined}
      poolBalancesPending={false}
      usdPrice={undefined}
    />,
  );
}

// the fixture's one pool holds 40 UP and 12.5 underlying
const balances: PoolBalances = {
  [stats.pools[0]!.id]: { outcome: parseEther("40"), underlying: parseEther("12.5") },
};

function headerWith(pool: { balances: PoolBalances | undefined; pending: boolean }) {
  return (
    <SessionHeader
      session={toSessionDetail(row(), GATEWAY)}
      status="trading"
      stats={stats}
      statsPending={false}
      poolBalances={pool.balances}
      poolBalancesPending={pool.pending}
      usdPrice={undefined}
    />
  );
}

describe("SessionHeader", () => {
  it("shows the session's title as the page heading", () => {
    renderHeader();

    expect(screen.getByRole("heading", { level: 1, name: "Dune: Part Three, director" })).toBeInTheDocument();
  });

  it("shows the question on the hero card", () => {
    renderHeader();

    expect(screen.getByText("Which director for Dune: Part Three?")).toBeInTheDocument();
  });

  it("shows the creator's context under the question", () => {
    renderHeader();

    expect(screen.getByText("Opening weekend gross per director.")).toBeInTheDocument();
  });

  it("paints the hero banner from the session's image", () => {
    const { container } = renderHeader({ overrides: { heroImage: "ipfs://QmHero" } });

    expect(container.querySelector('[role="presentation"]')).toHaveStyle({
      backgroundImage: `url("${GATEWAY}/QmHero")`,
    });
  });

  it("falls back to the gradient when the hero image fails to load", () => {
    const { container } = renderHeader({ overrides: { heroImage: "ipfs://QmHero" } });

    fireEvent.error(screen.getByTestId("hero-probe"));

    expect(container.querySelector('[role="presentation"]')).toHaveStyle({
      backgroundImage: expect.stringContaining("linear-gradient"),
    });
  });

  it("drops the session icon when it fails to load", () => {
    renderHeader({ overrides: { icon: "ipfs://QmIcon" } });

    fireEvent.error(screen.getByTestId("session-icon"));

    expect(screen.queryByTestId("session-icon")).toBeNull();
  });

  it("shows the session icon over the banner edge", () => {
    const { container } = renderHeader({ overrides: { icon: "ipfs://QmIcon" } });

    expect(container.querySelector("img")).toHaveAttribute("src", `${GATEWAY}/QmIcon`);
  });

  it("tags a live session as trading", () => {
    renderHeader({ status: "trading" });

    expect(screen.getByText("Trading")).toBeInTheDocument();
  });

  it("shows how many traders have taken part", () => {
    renderHeader();

    expect(screen.getByText("148")).toBeInTheDocument();
  });

  it("shows lifetime volume in the collateral's own name, one Nth per outcome token", () => {
    renderHeader();

    // 92000.5 over the fixture's 2 outcomes.
    expect(screen.getByText("~46,000.25 sDAI")).toBeInTheDocument();
  });

  it("keeps showing volume, unnamed, where the collateral read failed", () => {
    renderHeader({ overrides: { collateralDecimals: null, collateralSymbol: null, children: [] } });

    expect(screen.getByText("~46,000.25")).toBeInTheDocument();
  });

  it("shows a dash where the stats could not be loaded", () => {
    render(
      <SessionHeader
        session={toSessionDetail(row(), GATEWAY)}
        status="trading"
        stats={undefined}
        statsPending={false}
        poolBalances={undefined}
        poolBalancesPending
        usdPrice={undefined}
      />,
    );

    expect(screen.getAllByText("-")).toHaveLength(4);
  });

  it("holds skeletons, not numbers, while the stats load", () => {
    const { container } = render(
      <SessionHeader
        session={toSessionDetail(row(), GATEWAY)}
        status="trading"
        stats={undefined}
        statsPending
        poolBalances={undefined}
        poolBalancesPending
        usdPrice={undefined}
      />,
    );

    expect(screen.queryByText("-")).toBeNull();
    expect(container.querySelectorAll(".fs-skeleton")).toHaveLength(4);
  });

  it("shows a dash on Liquidity alone, with nothing to open, where the pool balances could not be read", () => {
    renderHeader();

    expect(screen.getByText("Liquidity:").parentElement).toHaveTextContent(/^Liquidity:\s*-$/);
    expect(screen.queryByRole("button", { name: /^Liquidity/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Volume/ })).toBeInTheDocument();
  });

  it("closes a stat's popup when the stat is pressed again", async () => {
    renderHeader();
    await userEvent.click(screen.getByRole("button", { name: /^Volume/ }));
    expect(screen.getByRole("dialog", { name: "Volume" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Volume/ }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hands focus back to the stat on Escape where pressing it did not focus it", async () => {
    renderHeader();
    // a click that moves no focus, as Safari's on a button
    fireEvent.click(screen.getByRole("button", { name: /^Volume/ }));
    expect(screen.getByRole("dialog", { name: "Volume" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: /^Volume/ })).toHaveFocus();
  });

  it("marks a stat expanded while its popup shows", async () => {
    renderHeader();
    const volume = screen.getByRole("button", { name: /^Volume/ });
    expect(volume).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(volume);
    expect(volume).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(volume);
    expect(volume).toHaveAttribute("aria-expanded", "false");
  });

  it("swaps one stat's popup for another's when the other stat is pressed", async () => {
    renderHeader();
    await userEvent.click(screen.getByRole("button", { name: /^Volume/ }));

    await userEvent.click(screen.getByRole("button", { name: /^Notional volume/ }));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Notional volume" })).toBeInTheDocument();
  });

  it("closes the Liquidity popup from its stat after the stat reloaded under it", async () => {
    const { rerender } = render(headerWith({ balances, pending: false }));
    const first = screen.getByRole("button", { name: /^Liquidity/ });
    await userEvent.click(first);
    rerender(headerWith({ balances: undefined, pending: true }));
    rerender(headerWith({ balances, pending: false }));
    expect(first).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Liquidity" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Liquidity/ }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hands focus to the Liquidity stat on Escape after the stat reloaded under its popup", async () => {
    const { rerender } = render(headerWith({ balances, pending: false }));
    const first = screen.getByRole("button", { name: /^Liquidity/ });
    await userEvent.click(first);
    rerender(headerWith({ balances: undefined, pending: true }));
    rerender(headerWith({ balances, pending: false }));
    expect(first).not.toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: /^Liquidity/ })).toHaveFocus();
  });

  it("reads a pool's holdings in the collateral's own decimals", async () => {
    // a 6-decimal collateral, whose outcome and underlying tokens share its decimals
    const pool = { ...stats.pools[0]!, volumeUnderlying: parseUnits("10", 6), volumeOutcome: parseUnits("10", 6) };
    render(
      <SessionHeader
        session={toSessionDetail(row({ collateralDecimals: 6, collateralSymbol: "USDC" }), GATEWAY)}
        status="trading"
        stats={{ ...stats, volumeUnderlying: pool.volumeUnderlying, volumeOutcome: pool.volumeOutcome, pools: [pool] }}
        statsPending={false}
        poolBalances={{ [pool.id]: { outcome: parseUnits("40", 6), underlying: parseUnits("12.5", 6) } }}
        poolBalancesPending={false}
        usdPrice={undefined}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^Liquidity/ }));

    expect(screen.getByRole("dialog", { name: "Liquidity" })).toHaveTextContent("40 UP / 12.5 underlying");
  });

  it("holds a skeleton on Liquidity alone while the pool balances load", () => {
    const { container } = render(
      <SessionHeader
        session={toSessionDetail(row(), GATEWAY)}
        status="trading"
        stats={stats}
        statsPending={false}
        poolBalances={undefined}
        poolBalancesPending
        usdPrice={undefined}
      />,
    );

    const skeletons = container.querySelectorAll(".fs-skeleton");
    expect(skeletons).toHaveLength(1);
    expect(skeletons[0]!.parentElement).toHaveTextContent("Liquidity:");
  });

  it("omits the trading period while the closing time is unknown", () => {
    renderHeader({ overrides: { openingTime: null } });

    expect(screen.queryByText("Trading until:")).toBeNull();
    expect(screen.queryByText("Countdown:")).toBeNull();
  });

  it("keeps the countdown for sessions still trading", () => {
    renderHeader({ status: "trading" });

    expect(screen.getByText("Countdown:")).toBeInTheDocument();
  });

  it("drops the countdown once trading closed", () => {
    renderHeader({ status: "closed" });

    expect(screen.queryByText("Countdown:")).toBeNull();
  });

  it("warns while the session is still being set up", () => {
    renderHeader({ overrides: { completedAt: "0" }, status: "setting-up" });

    expect(screen.getByText("Setup unfinished")).toBeInTheDocument();
  });

  it("notes quietly when display details failed to load", () => {
    renderHeader({ overrides: { metadataResolved: false, title: null, description: null } });

    expect(screen.getByText(/display details for this session could not be loaded/)).toBeInTheDocument();
  });

  it("keeps quiet about display details when they loaded", () => {
    renderHeader();

    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  /* DEFAULT_CHAIN is the local node under test, and a local node has no explorer to link to.
     Where one exists the link is built by `explorerAddressUrl`, which has its own tests. */
  it("offers no explorer link on a chain without an explorer", () => {
    renderHeader();

    expect(screen.queryByRole("link", { name: /0x/ })).toBeNull();
  });
});

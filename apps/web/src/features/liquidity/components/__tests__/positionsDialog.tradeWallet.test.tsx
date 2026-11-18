import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { executorAddress } from "@/lib/trade-executor/executor";

import { tradeExecutorFactoryAddress } from "@/config/contracts";

import { owner } from "../../flow/__tests__/support/session";
import type { LiquidityRun } from "../../hooks/useLiquidityRun";
import type { ShownPosition } from "../../hooks/useSessionLiquidity";
import { removeInput, SESSION } from "../../run/__tests__/support/requests";
import { LiquidityPositionsDialog } from "../LiquidityPositionsDialog";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

const WAD = 10n ** 18n;
const NAMES = ["Denis Villeneuve"];
const UP_POOL = `${NAMES[0]} UP pool`;
const DOWN_POOL = `${NAMES[0]} DOWN pool`;
const tradeWallet = executorAddress(tradeExecutorFactoryAddress(100)!, owner);

const idle: LiquidityRun = {
  progress: { stage: "idle", rows: [], signatures: { done: 0, total: 0 } },
  start: () => {},
  resume: () => {},
  retry: () => {},
  reset: () => {},
  discard: () => {},
  isRunning: false,
  isHeld: false,
};

/** The wallet's position 78 in the UP pool, and the trade wallet's position 77 in the DOWN pool. */
const POSITIONS: ShownPosition[] = [
  {
    key: "0:up",
    pool: UP_POOL,
    count: 1,
    returns: [{ label: "sDAI", amount: WAD }],
    heldBy: "wallet",
    request: { kind: "remove", session: SESSION, input: removeInput({ tokenIds: [78n] }) },
  },
  {
    key: "tradeWallet:0:down",
    pool: DOWN_POOL,
    count: 1,
    returns: [{ label: "sDAI", amount: WAD }],
    heldBy: "tradeWallet",
    request: { kind: "remove", session: SESSION, input: { ...removeInput({ tokenIds: [77n] }), tradeWallet } },
  },
];

const popup = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LiquidityPositionsDialog isOpen onClose={() => {}} names={NAMES} positions={POSITIONS} run={idle} />
    </QueryClientProvider>,
  );

/** The list row naming `pool`. */
const rowOf = (pool: string) =>
  screen.getAllByRole("listitem").find((item) => within(item).queryByText(pool) !== null)!;

describe("Your positions listing a trade wallet's positions", () => {
  it("says a trade wallet row's positions are in the trade wallet", () => {
    popup();

    expect(within(rowOf(DOWN_POOL)).getByText(/In your trade wallet/)).toBeTruthy();
  });

  it("says nothing of the trade wallet on the wallet's own row", () => {
    popup();

    expect(within(rowOf(UP_POOL)).queryByText(/In your trade wallet/)).toBeNull();
  });

  it("names the trade wallet in a trade wallet row's Remove", () => {
    popup();

    const remove = within(rowOf(DOWN_POOL)).getByRole("button", { name: /^Remove / });
    expect(remove.getAttribute("aria-label")).toMatch(/trade wallet/);
  });
});

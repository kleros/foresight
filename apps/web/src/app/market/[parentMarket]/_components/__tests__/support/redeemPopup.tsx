import { fireEvent, render, screen } from "@testing-library/react";
import type { Address } from "viem";
import { vi } from "vitest";

import type { ParentResolution } from "@/features/resolution/api/getSessionResolution";
import {
  childMarket,
  OWNER,
  PARENT,
  plannerInput,
  TWO_WINNERS,
} from "@/features/resolution/redeem/__tests__/support/session";
import { planWalletRedeem, type RedeemPlan } from "@/features/resolution/redeem/plan";
import type { RedeemProgress } from "@/features/resolution/redeem/run";
import type { RealisedPnl } from "@/features/resolution/utils/realisedPnl";

import { RedeemPopup } from "../../RedeemPopup";
import { useRedeemFromTradeWallet, useTradeWalletOwner, useTradeWalletRedeem } from "../../useTradeWalletRedeem";
import { useWalletRedeem, useWalletRedeemRun, type WalletRedeemRead } from "../../useWalletRedeem";

/**
 * Drives `RedeemPopup` through mocked hooks. A test file mocks both hook modules:
 *   vi.mock("../useTradeWalletRedeem", () => ({ useTradeWalletRedeem: vi.fn(), useRedeemFromTradeWallet: vi.fn(), useTradeWalletOwner: vi.fn() }));
 *   vi.mock("../useWalletRedeem", () => ({ useWalletRedeem: vi.fn(), useWalletRedeemRun: vi.fn() }));
 */

export const SESSION = { sessionFactory: "0x5f00000000000000000000000000000000000000" as Address, sessionId: 7n };
export const OPTIONS = [
  { market: childMarket(0), outcomeIndex: 0, name: "Denis Villeneuve" },
  { market: childMarket(1), outcomeIndex: 1, name: "Greta Gerwig" },
  { market: childMarket(2), outcomeIndex: 2, name: "Christopher Nolan" },
];
export const NOTHING: RedeemPlan = { parts: [], waiting: [], payout: 0n, tx: null };

export function walletRead(overrides: Parameters<typeof plannerInput>[0] = {}): WalletRedeemRead {
  const input = plannerInput(overrides);
  return { input, plan: planWalletRedeem(input) };
}
export const NOTHING_IN_WALLET = () => walletRead({ parentBalances: [0n, 0n, 0n, 0n], childBalances: [] });

export const tradeRefetch = vi.fn();
export const walletRefetch = vi.fn();
export const mutateAsync = vi.fn(async () => ({ status: "success" }));
export const tradeReset = vi.fn();
export const handle = { start: vi.fn(), resume: vi.fn(), retry: vi.fn(), reset: vi.fn(), discard: vi.fn() };

export function tradeList(state: {
  data?: RedeemPlan;
  isError?: boolean;
  isFetching?: boolean;
  owner?: Address;
  /** An account is connected on another chain than redeem reads and sends on. */
  isWrongChain?: boolean;
}) {
  vi.mocked(useTradeWalletRedeem).mockReturnValue({
    data: state.data,
    isError: state.isError ?? false,
    isFetching: state.isFetching ?? false,
    owner: "owner" in state ? state.owner : OWNER,
    isWrongChain: state.isWrongChain ?? false,
    refetch: tradeRefetch,
  } as unknown as ReturnType<typeof useTradeWalletRedeem>);
}

type TradeRunState = Partial<Pick<ReturnType<typeof useRedeemFromTradeWallet>, "isPending" | "stage" | "failure">>;

/** The trade wallet's send: pending or not, or with the stage it is at and the failure it stopped on. */
export function tradeRun(state: boolean | TradeRunState = false) {
  const { isPending = false, stage, failure } = typeof state === "boolean" ? { isPending: state } : state;
  vi.mocked(useRedeemFromTradeWallet).mockReturnValue({
    mutateAsync,
    isPending,
    stage,
    failure,
    reset: tradeReset,
  } as unknown as ReturnType<typeof useRedeemFromTradeWallet>);
}

/** `owner()` of the trade wallet as the box reads it; called with whether the box is ticked. */
export function tradeOwner(owner: Address | undefined) {
  vi.mocked(useTradeWalletOwner).mockImplementation(
    (_account, enabled) =>
      ({ data: enabled ? owner : undefined, isError: false }) as unknown as ReturnType<typeof useTradeWalletOwner>,
  );
}

/** `owner()` as TanStack Query keeps it once read: still there after the box is unticked or the popup reopens. */
export function tradeOwnerCached(owner: Address) {
  vi.mocked(useTradeWalletOwner).mockReturnValue({ data: owner, isError: false } as unknown as ReturnType<
    typeof useTradeWalletOwner
  >);
}

export function walletList(state: {
  data?: WalletRedeemRead;
  isError?: boolean;
  isFetching?: boolean;
  owner?: Address;
}) {
  vi.mocked(useWalletRedeem).mockReturnValue({
    data: state.data,
    isError: state.isError ?? false,
    isFetching: state.isFetching ?? false,
    owner: "owner" in state ? state.owner : OWNER,
    refetch: walletRefetch,
  } as unknown as ReturnType<typeof useWalletRedeem>);
}

export function walletRun(progress: RedeemProgress | null) {
  vi.mocked(useWalletRedeemRun).mockReturnValue({
    progress,
    ...handle,
    isRunning: progress?.stage === "signing" || progress?.stage === "confirming",
  });
}

/** Nothing in either wallet, no run, the trade wallet owned by the connected account. */
export function resetHooks() {
  vi.clearAllMocks();
  tradeList({ data: NOTHING });
  tradeRun();
  tradeOwner(OWNER);
  walletList({ data: NOTHING_IN_WALLET() });
  walletRun({ stage: "idle" });
}

export const popup = (props: { parent?: ParentResolution | Error; pnl?: RealisedPnl } = {}) => (
  <RedeemPopup
    session={SESSION}
    parent={props.parent ?? TWO_WINNERS.parent}
    parentMarket={PARENT}
    options={OPTIONS}
    pnl={props.pnl}
    noun="directors"
  />
);

export const renderPopup = (props: Parameters<typeof popup>[0] = {}) => render(popup(props));

/** The page's Redeem button, labelled with the amount both wallets redeem: `Redeem 4.90 sDAI`. */
export const TRIGGER = /^Redeem( |$)/;

/** Presses the page's Redeem button and returns the dialog it opens. */
export function openPopup(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: TRIGGER }));
  return screen.getByRole("dialog");
}

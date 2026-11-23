import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  childMarket,
  OWNER,
  PARENT,
  plannerInput,
  TWO_WINNERS,
} from "@/features/resolution/redeem/__tests__/support/session";
import { planWalletRedeem } from "@/features/resolution/redeem/plan";
import type { RedeemProgress } from "@/features/resolution/redeem/run";

import { useWalletRedeem, useWalletRedeemRun, type WalletRedeemRead } from "../useWalletRedeem";
import { START_OVER_WARNING, WalletRedeemSection } from "../WalletRedeemSection";

vi.mock("../useWalletRedeem", () => ({ useWalletRedeem: vi.fn(), useWalletRedeemRun: vi.fn() }));

const SESSION = { sessionFactory: "0x5f00000000000000000000000000000000000000" as Address, sessionId: 7n };
const OPTIONS = [
  { market: childMarket(0), outcomeIndex: 0, name: "Denis Villeneuve" },
  { market: childMarket(1), outcomeIndex: 1, name: "Greta Gerwig" },
  { market: childMarket(2), outcomeIndex: 2, name: "Christopher Nolan" },
];

const refetch = vi.fn();
const handle = {
  start: vi.fn(),
  resume: vi.fn(),
  retry: vi.fn(),
  reset: vi.fn(),
  discard: vi.fn(),
};

function read(overrides: Parameters<typeof plannerInput>[0] = {}): WalletRedeemRead {
  const input = plannerInput(overrides);
  return { input, plan: planWalletRedeem(input) };
}

function list(state: { data?: WalletRedeemRead; isError?: boolean; isFetching?: boolean; owner?: Address }) {
  vi.mocked(useWalletRedeem).mockReturnValue({
    data: state.data,
    isError: state.isError ?? false,
    isFetching: state.isFetching ?? false,
    owner: "owner" in state ? state.owner : OWNER,
    refetch,
  } as unknown as ReturnType<typeof useWalletRedeem>);
}

function running(progress: RedeemProgress | null) {
  vi.mocked(useWalletRedeemRun).mockReturnValue({
    progress,
    ...handle,
    isRunning: progress?.stage === "signing" || progress?.stage === "confirming",
  });
}

const renderSection = () =>
  render(<WalletRedeemSection session={SESSION} parent={TWO_WINNERS.parent} parentMarket={PARENT} options={OPTIONS} />);

const section = () => screen.getByRole("region", { name: "Redeem from your wallet" });

beforeEach(() => {
  vi.clearAllMocks();
  list({ data: read() });
  running({ stage: "idle" });
});

/** Ported from liquidity `startOver.test.tsx`. */
describe("WalletRedeemSection Start over", () => {
  it("asks again on a later hold, not carrying an earlier press over a run that went on", () => {
    const held: RedeemProgress = { stage: "halted", failure: { reason: "held", retryable: true }, holdsSend: true };
    running(held);
    const view = renderSection();
    fireEvent.click(within(section()).getByRole("button", { name: "Start over" }));
    expect(within(section()).getByRole("alert")).toHaveTextContent(START_OVER_WARNING);

    running({ stage: "signing" });
    view.rerender(
      <WalletRedeemSection session={SESSION} parent={TWO_WINNERS.parent} parentMarket={PARENT} options={OPTIONS} />,
    );
    running(held);
    view.rerender(
      <WalletRedeemSection session={SESSION} parent={TWO_WINNERS.parent} parentMarket={PARENT} options={OPTIONS} />,
    );

    expect(within(section()).queryByRole("alert")).toBeNull();
    expect(handle.discard).not.toHaveBeenCalled();
  });
});

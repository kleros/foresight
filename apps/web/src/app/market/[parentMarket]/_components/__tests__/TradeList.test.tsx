import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseEther } from "viem";
import { describe, expect, it, vi } from "vitest";

import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";
import { toPredictions } from "@/features/sessions/utils/toSessionTrades";

import type { SessionTradesQuery } from "@/lib/graphql/generated/graphql";

import { addresses, GATEWAY } from "@/testing/fixtures";

import { TradeList } from "../TradeList";

vi.mock("wagmi", () => ({ useAccount: () => ({ address: undefined }) }));

const wei = (amount: string) => parseEther(amount).toString();

/** One outcome, so an amount of underlying reads as the same amount of collateral. */
const session = toSessionDetail(
  {
    ...sessionDetailColumns,
    outcomeCount: "1",
    collateralDecimals: 18,
    collateralSymbol: "sDAI",
    children: [sessionChildRow()],
  },
  GATEWAY,
);

type PredictionRow = SessionTradesQuery["Prediction"][number];

/** One option's slice of a prediction in the trade wallet's own columns, every one zero unless set. */
function row(tx: string, columns: Partial<PredictionRow>): PredictionRow {
  return {
    transactionHash: tx,
    blockNumber: "100",
    timestamp: "1756000000",
    childMarket_id: addresses.childMarkets[0]!,
    executor_id: "0x777777777777777777777777777777777777a001",
    executor: { owner: "0x777777777777777777777777777777777777a001" },
    downDelta: "0",
    upDelta: "0",
    downBalance: "0",
    upBalance: "0",
    downSwapUnderlying: "0",
    downSwapTokens: "0",
    upSwapUnderlying: "0",
    upSwapTokens: "0",
    downAvgPrice: null,
    upAvgPrice: null,
    downPriceBefore: null,
    downPriceAfter: null,
    upPriceBefore: null,
    upPriceAfter: null,
    ...columns,
  };
}

const tradesOf = (rows: PredictionRow[]) => toPredictions(rows).map((group) => group.trade);

describe("TradeList rows", () => {
  it("sizes a prediction that took more underlying out than it put in by the amount, unsigned", () => {
    // 10 UP sold for 3.1: cost -3.1
    const trades = tradesOf([
      row("0x01", {
        upDelta: `-${wei("10")}`,
        upSwapTokens: `-${wei("10")}`,
        upSwapUnderlying: wei("3.1"),
        upAvgPrice: wei("0.31"),
      }),
    ]);

    render(<TradeList session={session} trades={trades} />);

    const prediction = screen.getByRole("button");
    expect(prediction.textContent).toContain("~3.1 sDAI");
    expect(prediction.textContent).not.toMatch(/~-/);
  });
});

describe("the prediction popup from TradeList", () => {
  it("shows the sets a prediction merged", async () => {
    // 4 UP and 4 DOWN merged back for 4 underlying, no swaps
    const trades = tradesOf([
      row("0x02", { upDelta: `-${wei("4")}`, downDelta: `-${wei("4")}`, upBalance: wei("6"), downBalance: wei("6") }),
    ]);
    render(<TradeList session={session} trades={trades} />);

    await userEvent.click(screen.getByRole("button"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Merge").parentElement!.textContent).toContain("4 DOWN + UP");
    expect(within(dialog).queryByText("Mint")).toBeNull();
  });

  it("shows the sets a prediction minted", async () => {
    // 10 sets minted, the 10 DOWN sold for 6.5
    const trades = tradesOf([
      row("0x03", {
        upDelta: wei("10"),
        upBalance: wei("10"),
        downSwapTokens: `-${wei("10")}`,
        downSwapUnderlying: wei("6.5"),
        downAvgPrice: wei("0.65"),
      }),
    ]);
    render(<TradeList session={session} trades={trades} />);

    await userEvent.click(screen.getByRole("button"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Mint").parentElement!.textContent).toContain("10 DOWN + UP");
  });
});

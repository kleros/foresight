import type { ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import { getAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import type { SessionDetail, SessionStatus } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { addresses, GATEWAY } from "@/testing/fixtures";

import { PredictCard } from "../PredictCard";

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: "0xa11ce000000000000000000000000000000a11ce" }),
}));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));

const CLOSED = "Trading has closed.";
const NO_LIQUIDITY = "None of the directors can be traded yet.";
const NO_ESTIMATE_MOVED = "Set an estimate above or below the market to predict.";

const session = (markets: readonly string[] = addresses.childMarkets) =>
  toSessionDetail(
    {
      ...sessionDetailColumns,
      id: "7",
      children: [
        sessionChildRow({ id: markets[0], parentOutcomeIndex: "0" }),
        sessionChildRow({ id: markets[1], parentOutcomeIndex: "1" }),
      ],
    },
    GATEWAY,
  );

/** Every option has a pool price one above its lower bound. */
const pricedMarkets = (detail: SessionDetail) =>
  Object.fromEntries(detail.options.map((option) => [option.market.toLowerCase(), option.lowerBound + 1]));

/** Every option's estimate two above its lower bound, so one away from the pool price. */
function moveEveryEstimate(detail: SessionDetail) {
  for (const option of detail.options) {
    useEstimateStore.getState().setEstimate(detail.parentMarket, option.market, option.lowerBound + 2);
  }
}

function renderCard(
  detail: SessionDetail,
  status: SessionStatus,
  marketEstimates: Record<string, number | undefined>,
  isMarketUnknown = false,
) {
  render(
    <PredictCard
      session={detail}
      status={status}
      marketEstimates={marketEstimates}
      isMarketUnknown={isMarketUnknown}
    />,
  );
  return screen.getByRole("button", { name: /^Predict (\d+ )?estimates?$/ });
}

beforeEach(() => {
  window.localStorage.clear();
  useEstimateStore.getState().resetEstimates(session().parentMarket);
});

describe("the predict card's button", () => {
  it("counts the estimates it would place", () => {
    const detail = session();
    moveEveryEstimate(detail);

    const button = renderCard(detail, "trading", pricedMarkets(detail));

    expect(button).toHaveTextContent("Predict 2 estimates");
    expect(screen.getByRole("heading", { name: "Place your estimates" })).toBeInTheDocument();
  });
});

describe("the predict card names one reason Predict is disabled", () => {
  it("says trading has closed on a closed session", () => {
    const detail = session();
    moveEveryEstimate(detail);

    const button = renderCard(detail, "closed", pricedMarkets(detail));

    expect(button).toBeDisabled();
    expect(screen.getByText(CLOSED)).toBeVisible();
  });

  it("says none of the options can be traded when no option has a market estimate", () => {
    const detail = session();
    moveEveryEstimate(detail);

    const button = renderCard(detail, "trading", {});

    expect(button).toBeDisabled();
    expect(screen.getByText(NO_LIQUIDITY)).toBeVisible();
  });

  it("says to move an estimate when no estimate has been set", () => {
    const detail = session();

    const button = renderCard(detail, "trading", pricedMarkets(detail));

    expect(button).toBeDisabled();
    expect(screen.getByText(NO_ESTIMATE_MOVED)).toBeVisible();
  });

  it("says to move an estimate when every estimate sits at the market", () => {
    const detail = session();
    const marketEstimates = pricedMarkets(detail);
    for (const option of detail.options) {
      useEstimateStore.getState().setEstimate(detail.parentMarket, option.market, option.lowerBound + 1);
    }

    const button = renderCard(detail, "trading", marketEstimates);

    expect(button).toBeDisabled();
    expect(screen.getByText(NO_ESTIMATE_MOVED)).toBeVisible();
  });

  it("says only that trading has closed when the options also have no liquidity", () => {
    const detail = session();

    renderCard(detail, "closed", {});

    expect(screen.getByText(CLOSED)).toBeVisible();
    expect(screen.queryByText(NO_LIQUIDITY)).toBeNull();
    expect(screen.queryByText(NO_ESTIMATE_MOVED)).toBeNull();
  });

  it("says to move an estimate when only some options have liquidity", () => {
    const detail = session();
    const priced = detail.options[0]!;

    renderCard(detail, "trading", { [priced.market.toLowerCase()]: priced.lowerBound + 1 });

    expect(screen.getByText(NO_ESTIMATE_MOVED)).toBeVisible();
    expect(screen.queryByText(NO_LIQUIDITY)).toBeNull();
  });

  it("says to move an estimate on a session whose market addresses are checksummed", () => {
    const detail = session(addresses.childMarkets.map((market) => getAddress(market)));
    const market = detail.options[0]!.market;
    expect(market).not.toBe(market.toLowerCase());

    renderCard(detail, "trading", pricedMarkets(detail));

    expect(screen.getByText(NO_ESTIMATE_MOVED)).toBeVisible();
    expect(screen.queryByText(NO_LIQUIDITY)).toBeNull();
  });

  it("says there is no liquidity when the caller does not say whether the market is known", () => {
    const detail = session();

    render(<PredictCard session={detail} status="trading" marketEstimates={{}} />);

    expect(screen.getByText(NO_LIQUIDITY)).toBeVisible();
  });

  it("says only that there is no liquidity when no estimate has been moved either", () => {
    const detail = session();

    renderCard(detail, "trading", {});

    expect(screen.getByText(NO_LIQUIDITY)).toBeVisible();
    expect(screen.queryByText(NO_ESTIMATE_MOVED)).toBeNull();
  });
});

describe("the predict card gives no disabled reason", () => {
  it("once an estimate is moved on a trading session", () => {
    const detail = session();
    moveEveryEstimate(detail);

    const button = renderCard(detail, "trading", pricedMarkets(detail));

    expect(button).toBeEnabled();
    for (const reason of [CLOSED, NO_LIQUIDITY, NO_ESTIMATE_MOVED]) {
      expect(screen.queryByText(reason)).toBeNull();
    }
  });

  it("once an estimate is moved on the one option with liquidity", () => {
    const detail = session();
    const priced = detail.options[0]!;
    useEstimateStore.getState().setEstimate(detail.parentMarket, priced.market, priced.lowerBound + 2);

    const button = renderCard(detail, "trading", { [priced.market.toLowerCase()]: priced.lowerBound + 1 });

    expect(button).toBeEnabled();
    for (const reason of [CLOSED, NO_LIQUIDITY, NO_ESTIMATE_MOVED]) {
      expect(screen.queryByText(reason)).toBeNull();
    }
  });

  it("while the session is setting up", () => {
    const detail = session();

    const button = renderCard(detail, "setting-up", {});

    expect(button).toBeDisabled();
    for (const reason of [CLOSED, NO_LIQUIDITY, NO_ESTIMATE_MOVED]) {
      expect(screen.queryByText(reason)).toBeNull();
    }
  });

  it("while the market estimates are not known", () => {
    const detail = session();

    renderCard(detail, "trading", {}, true);

    expect(screen.queryByText(NO_LIQUIDITY)).toBeNull();
    expect(screen.queryByText(NO_ESTIMATE_MOVED)).toBeNull();
  });
});

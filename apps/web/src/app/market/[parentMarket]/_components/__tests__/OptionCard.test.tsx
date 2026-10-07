import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import { estimateStep } from "@/features/predict/utils/estimates";
import type { SessionOption, SessionStatus } from "@/features/sessions/types";

import { addresses } from "@/testing/fixtures";

import { OptionCard } from "../OptionCard";

const option: SessionOption = {
  market: addresses.childMarkets[0],
  outcomeIndex: 1,
  name: "Greta Gerwig",
  color: "#009aff",
  question: "Opening weekend gross if Gerwig directs",
  unit: "$M",
  lowerBound: 0,
  upperBound: 500,
  upToken: addresses.upToken,
  invalidToken: addresses.childInvalidToken,
  downToken: addresses.downToken,
  underlyingToken: addresses.underlyingToken,
  blocks: [{ type: "markdown", body: "Directed *Barbie*." }],
};

const PARENT = addresses.parentMarket;
const MARKET_ESTIMATE = 312;

function renderCard(overrides: { status?: SessionStatus; marketEstimate?: number; isMarketPending?: boolean } = {}) {
  return render(
    <OptionCard
      option={option}
      parentMarket={PARENT}
      status={overrides.status ?? "trading"}
      marketEstimate={"marketEstimate" in overrides ? overrides.marketEstimate : MARKET_ESTIMATE}
      isMarketPending={overrides.isMarketPending ?? false}
    />,
  );
}

async function open() {
  await userEvent.click(screen.getByText("Greta Gerwig"));
}

const saved = () => useEstimateStore.getState().estimates[PARENT]?.[option.market];

beforeEach(() => {
  useEstimateStore.setState({ estimates: {} });
});

describe("OptionCard", () => {
  it("shows the option's name and no tick while nothing is set", () => {
    renderCard();

    expect(screen.getByText("Greta Gerwig")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Estimate set" })).toBeNull();
  });

  it("opens to an estimate scale bounded in the option's own unit, with the market marked", async () => {
    renderCard();

    await open();

    expect(screen.getByText("0 $M")).toBeInTheDocument();
    expect(screen.getByText("500 $M")).toBeInTheDocument();
    expect(screen.getByText("Market 312 $M")).toBeInTheDocument();
  });

  it("starts the thumb at the market estimate", async () => {
    renderCard();

    await open();

    expect(screen.getByRole("slider")).toHaveValue(String(MARKET_ESTIMATE));
    expect(screen.getByText("At the market estimate. Move it to make a prediction.")).toBeInTheDocument();
  });

  it("saves a typed estimate and ticks the option", async () => {
    renderCard();
    await open();

    const field = screen.getByRole("textbox", { name: /Your estimate/ });
    await userEvent.clear(field);
    await userEvent.type(field, "250");
    await userEvent.tab();

    expect(saved()).toBe(250);
    expect(screen.getByText("Lower than the market estimate")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Estimate set" })).toBeInTheDocument();
  });

  it("saves a slider step made with the keyboard", async () => {
    renderCard();
    await open();

    screen.getByRole("slider").focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(saved()).toBe(MARKET_ESTIMATE + estimateStep(option));
    expect(screen.getByRole("img", { name: "Estimate set" })).toBeInTheDocument();
  });

  it("keeps a typed estimate inside the option's scale, which the field itself enforces", async () => {
    renderCard();
    await open();

    const field = screen.getByRole("textbox", { name: /Your estimate/ });
    await userEvent.clear(field);
    await userEvent.type(field, "900");
    await userEvent.tab();

    expect(saved()).toBe(500);
  });

  it("forgets an estimate typed back to the market's own number", async () => {
    useEstimateStore.getState().setEstimate(PARENT, option.market, 250);
    renderCard();
    await open();

    const field = screen.getByRole("textbox", { name: /Your estimate/ });
    await userEvent.clear(field);
    await userEvent.type(field, String(MARKET_ESTIMATE));
    await userEvent.tab();

    expect(saved()).toBeUndefined();
    expect(screen.queryByRole("img", { name: "Estimate set" })).toBeNull();
  });

  it("shows a saved estimate as the thumb and as higher than the market", async () => {
    useEstimateStore.getState().setEstimate(PARENT, option.market, 400);
    renderCard();

    await open();

    expect(screen.getByRole("slider")).toHaveValue("400");
    expect(screen.getByText("Higher than the market estimate")).toBeInTheDocument();
  });

  it("refuses estimates where the option has no trading", async () => {
    renderCard({ marketEstimate: undefined });

    await open();

    expect(screen.getByRole("slider")).toBeDisabled();
    expect(screen.getByText("No trading is available for this option yet.")).toBeInTheDocument();
  });

  it("refuses estimates while the session is still being set up", async () => {
    renderCard({ status: "setting-up" });

    await open();

    expect(screen.getByRole("slider")).toBeDisabled();
    expect(screen.getByText("Estimates open once every option is set up.")).toBeInTheDocument();
  });

  // REVISIT WHEN: the predict flow lands; a closed session should lock the slider again.
  it("still takes estimates after trading has closed, for now", async () => {
    renderCard({ status: "closed" });

    await open();

    expect(screen.getByRole("slider")).toBeEnabled();
  });

  it("says the market numbers could not be loaded, rather than that there is no trading", async () => {
    render(
      <OptionCard
        option={option}
        parentMarket={PARENT}
        status="trading"
        marketEstimate={undefined}
        isMarketPending={false}
        isMarketUnavailable
      />,
    );

    await open();

    expect(screen.getByRole("slider")).toBeDisabled();
    expect(screen.getByText("Market estimates could not be loaded. Reload in a moment.")).toBeInTheDocument();
    expect(screen.queryByText("No trading is available for this option yet.")).toBeNull();
  });

  it("waits for the market estimate before taking one", async () => {
    renderCard({ marketEstimate: undefined, isMarketPending: true });

    await open();

    expect(screen.getByRole("slider")).toBeDisabled();
    expect(screen.getByText("Loading the market estimate…")).toBeInTheDocument();
  });

  it("keeps a fine-grained estimate through the field on a narrow scale", async () => {
    const narrow = { ...option, unit: null, lowerBound: 0, upperBound: 1 };
    useEstimateStore.getState().setEstimate(PARENT, narrow.market, 0.12);
    render(
      <OptionCard
        option={narrow}
        parentMarket={PARENT}
        status="trading"
        marketEstimate={0.5}
        isMarketPending={false}
      />,
    );
    await open();

    const field = screen.getByRole("textbox", { name: /Your estimate/ });
    await userEvent.click(field);
    await userEvent.tab();
    expect(saved()).toBe(0.12);

    await userEvent.clear(field);
    await userEvent.type(field, "0.45");
    await userEvent.tab();
    expect(saved()).toBe(0.45);
  });

  it("shows the creator's content under details", async () => {
    renderCard();

    await open();
    await userEvent.click(screen.getByText("Details"));

    expect(screen.getByText("Opening weekend gross if Gerwig directs")).toBeInTheDocument();
    expect(screen.getByText("Barbie")).toBeInTheDocument();
  });

  it("reports an unreadable scale instead of drawing a slider", async () => {
    render(
      <OptionCard
        option={{ ...option, lowerBound: 0, upperBound: 0 }}
        parentMarket={PARENT}
        status="trading"
        marketEstimate={0}
        isMarketPending={false}
      />,
    );

    await open();

    expect(screen.getByText("The scale for this option could not be read.")).toBeInTheDocument();
    expect(screen.queryByRole("slider")).toBeNull();
  });
});

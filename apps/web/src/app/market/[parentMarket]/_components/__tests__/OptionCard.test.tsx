import { render, screen, within } from "@testing-library/react";
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

const WAD = 10n ** 18n;

function renderCard(
  overrides: {
    status?: SessionStatus;
    marketEstimate?: number;
    isMarketPending?: boolean;
    position?: { up: bigint; down: bigint };
  } = {},
) {
  return render(
    <OptionCard
      option={option}
      parentMarket={PARENT}
      status={overrides.status ?? "trading"}
      marketEstimate={"marketEstimate" in overrides ? overrides.marketEstimate : MARKET_ESTIMATE}
      isMarketPending={overrides.isMarketPending ?? false}
      position={overrides.position}
      collateralDecimals={18}
    />,
  );
}

async function open() {
  await userEvent.click(screen.getByText("Greta Gerwig"));
}

const saved = () => useEstimateStore.getState().estimates[PARENT]?.[option.market];

// jsdom computes no Tailwind, so the dimmed look is read from the class on each control's root.
const DIMMED = "opacity-50";

function estimateControls() {
  return {
    slider: screen.getByRole("slider"),
    sliderRoot: screen.getByRole("group", { name: new RegExp(`^Your estimate for ${option.name}`) }),
    field: screen.getByRole("textbox", { name: /Your estimate/ }),
    fieldRoot: screen.getByText("Your estimate").parentElement,
  };
}

beforeEach(() => {
  useEstimateStore.setState({ estimates: {} });
});

describe("OptionCard", () => {
  it("shows the option's name and no tick while nothing is set", () => {
    renderCard();

    expect(screen.getByText("Greta Gerwig")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Estimate set" })).toBeNull();
  });

  it("keeps the collapsed row to the name and a tick once an estimate is set", () => {
    useEstimateStore.getState().setEstimate(PARENT, option.market, 400);
    renderCard({ position: { up: 20n * WAD, down: 0n } });

    const row = screen.getByRole("button", { name: /Greta Gerwig/ });
    expect(within(row).getByRole("img", { name: "Estimate set" })).toBeInTheDocument();
    expect(row).toHaveTextContent(/^Greta Gerwig$/);
  });

  it("shows what the trade wallet holds of the option once it is opened", async () => {
    renderCard({ position: { up: 20n * WAD, down: 0n } });

    await open();

    expect(screen.getByRole("region", { name: "Your position" })).toHaveTextContent("20 UP · 0 DOWN");
  });

  it("says an estimate on the other side of the market from the position sells some of it", async () => {
    useEstimateStore.getState().setEstimate(PARENT, option.market, 200);
    renderCard({ position: { up: 20n * WAD, down: 0n } });

    await open();

    expect(screen.getByRole("region", { name: "Your position" })).toHaveTextContent(
      "Predicting 200 $M sells some of your UP.",
    );
  });

  it("says an estimate on the position's side adds to it", async () => {
    useEstimateStore.getState().setEstimate(PARENT, option.market, 400);
    renderCard({ position: { up: 20n * WAD, down: 0n } });

    await open();

    expect(screen.getByRole("region", { name: "Your position" })).toHaveTextContent("Predicting 400 $M adds to your UP.");
  });

  it("shows no position for an option the trade wallet holds none of", async () => {
    renderCard();

    await open();

    expect(screen.queryByRole("region", { name: "Your position" })).toBeNull();
  });

  it("opens to an estimate scale bounded in the option's own unit, with the market marked", async () => {
    renderCard();

    await open();

    expect(screen.getByText("0 $M")).toBeInTheDocument();
    expect(screen.getByText("500 $M")).toBeInTheDocument();
    expect(screen.getByTestId("market-chip")).toHaveTextContent("312 $M");
  });

  it("starts the thumb at the market estimate", async () => {
    renderCard();

    await open();

    expect(screen.getByRole("slider")).toHaveValue(String(MARKET_ESTIMATE));
    expect(screen.getByText("At the market. Move it to predict.")).toBeInTheDocument();
  });

  it("saves a typed estimate and ticks the option", async () => {
    renderCard();
    await open();

    const field = screen.getByRole("textbox", { name: /Your estimate/ });
    await userEvent.clear(field);
    await userEvent.type(field, "250");
    await userEvent.tab();

    expect(saved()).toBe(250);
    expect(screen.getByText("62 $M below the market (312 $M)")).toBeInTheDocument();
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
    expect(screen.getByText("88 $M above the market (312 $M)")).toBeInTheDocument();
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

  it("refuses estimates after trading has closed", async () => {
    renderCard({ status: "closed" });

    await open();

    const { slider, field } = estimateControls();
    expect(slider).toBeDisabled();
    expect(field).toBeDisabled();
    expect(screen.getByText("Trading has closed for this session.")).toBeInTheDocument();
  });

  it.each([
    { label: "a closed session", overrides: { status: "closed" as const } },
    { label: "an option with no trading", overrides: { marketEstimate: undefined } },
  ])("dims the slider and the field on $label", async ({ overrides }) => {
    renderCard(overrides);

    await open();

    const { slider, sliderRoot, field, fieldRoot } = estimateControls();
    expect(slider).toBeDisabled();
    expect(field).toBeDisabled();
    expect(sliderRoot).toHaveClass(DIMMED);
    expect(fieldRoot).toHaveClass(DIMMED);
  });

  it("leaves the slider and the field undimmed while the session trades", async () => {
    renderCard();

    await open();

    const { sliderRoot, fieldRoot } = estimateControls();
    expect(sliderRoot).not.toHaveClass(DIMMED);
    expect(fieldRoot).not.toHaveClass(DIMMED);
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

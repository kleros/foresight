import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { SessionOption } from "@/features/sessions/types";

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
  downToken: addresses.downToken,
  underlyingToken: addresses.underlyingToken,
  underlyingDecimals: 18,
  underlyingSymbol: "sDAI",
  blocks: [{ type: "markdown", body: "Directed *Barbie*." }],
};

async function open() {
  await userEvent.click(screen.getByText("Greta Gerwig"));
}

describe("OptionCard", () => {
  it("shows the option's name while collapsed", () => {
    render(<OptionCard option={option} />);

    expect(screen.getByText("Greta Gerwig")).toBeInTheDocument();
  });

  it("opens to an estimate scale bounded in the option's own unit", async () => {
    render(<OptionCard option={option} />);

    await open();

    expect(screen.getByText("0 $M")).toBeInTheDocument();
    expect(screen.getByText("500 $M")).toBeInTheDocument();
  });

  it("says plainly that estimates cannot be set yet", async () => {
    render(<OptionCard option={option} />);

    await open();

    expect(screen.getByText("Setting estimates is not available yet.")).toBeInTheDocument();
  });

  it("keeps the slider disabled", async () => {
    render(<OptionCard option={option} />);

    await open();

    expect(screen.getByRole("slider")).toBeDisabled();
  });

  it("shows the creator's content under details", async () => {
    render(<OptionCard option={option} />);

    await open();
    await userEvent.click(screen.getByText("Details"));

    expect(screen.getByText("Opening weekend gross if Gerwig directs")).toBeInTheDocument();
    expect(screen.getByText("Barbie")).toBeInTheDocument();
  });

  it("reports an unreadable scale instead of drawing a slider", async () => {
    render(<OptionCard option={{ ...option, lowerBound: 0, upperBound: 0 }} />);

    await open();

    expect(screen.getByText("The scale for this option could not be read.")).toBeInTheDocument();
    expect(screen.queryByText("Setting estimates is not available yet.")).toBeNull();
  });
});

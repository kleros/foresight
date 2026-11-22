import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { SessionOption } from "@/features/sessions/types";

import { addresses } from "@/testing/fixtures";

import { OptionCard } from "../OptionCard";
import { STATUS_REASON } from "../statusReason";

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
  blocks: [],
};

describe.each(["resolved", "unknown"] as const)("OptionCard under status %s", (status) => {
  it("locks the estimate and says why", async () => {
    render(
      <OptionCard
        option={option}
        parentMarket={addresses.parentMarket}
        status={status}
        marketEstimate={312}
        isMarketPending={false}
      />,
    );
    await userEvent.click(screen.getByText("Greta Gerwig"));

    expect(screen.getByRole("slider")).toBeDisabled();
    expect(screen.getByText(STATUS_REASON[status])).toBeInTheDocument();
  });
});

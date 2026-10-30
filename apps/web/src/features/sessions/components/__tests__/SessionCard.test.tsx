import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { formatUtcInstant } from "@/utils/date";

import { GATEWAY } from "@/testing/fixtures";

import { sessionColumns } from "../../utils/__tests__/fixtures";
import { toSessionSummary, type SessionRow } from "../../utils/toSessionSummary";
import { SessionCard } from "../SessionCard";

/** 1 January 2100, so the resolution date is ahead whatever the wall clock reads. */
const FUTURE = "4102444800";
/** 2025-09-03, already past. */
const PAST = "1756900800";

function renderCard(openingTime: string | null) {
  const row: SessionRow = {
    ...sessionColumns,
    itemNamePlural: "Directors",
    outcomeCount: "3",
    keyword: "dune part three director",
    openingTime,
  };
  return render(<SessionCard session={toSessionSummary(row, GATEWAY)} />);
}

describe("SessionCard", () => {
  it("labels the Reality question's opening time as when resolution opens", () => {
    renderCard(FUTURE);

    expect(screen.getByText("Resolution opens:").parentElement).toHaveTextContent(
      formatUtcInstant(new Date(Number(FUTURE) * 1000)),
    );
    expect(screen.queryByText("Trading until:")).toBeNull();
  });

  it("counts down to the resolution date before it", () => {
    renderCard(FUTURE);

    expect(screen.getByText("Countdown:")).toBeInTheDocument();
  });

  it("keeps the date and drops the countdown once the date has passed", () => {
    renderCard(PAST);

    expect(screen.getByText("Resolution opens:")).toBeInTheDocument();
    expect(screen.queryByText("Countdown:")).toBeNull();
  });

  it("shows neither while the date is unknown", () => {
    renderCard(null);

    expect(screen.queryByText("Resolution opens:")).toBeNull();
    expect(screen.queryByText("Countdown:")).toBeNull();
  });
});

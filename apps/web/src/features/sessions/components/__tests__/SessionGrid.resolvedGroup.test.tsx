import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GATEWAY } from "@/testing/fixtures";

import type { SessionSummary } from "../../types";
import { sessionColumns } from "../../utils/__tests__/fixtures";
import { toSessionSummary, type SessionRow } from "../../utils/toSessionSummary";
import { SessionGrid } from "../SessionGrid";

const FUTURE = "4102444800";

function summary(id: string, title: string, extra: Partial<SessionSummary> = {}, openingTime: string | null = FUTURE) {
  const row: SessionRow = {
    ...sessionColumns,
    id,
    parentMarket: `0x${id.padStart(40, "0")}`,
    title,
    itemNamePlural: "Talks",
    outcomeCount: "3",
    keyword: title.toLowerCase(),
    openingTime,
  };
  return { ...toSessionSummary(row, GATEWAY), ...extra };
}

const resolvedGroup = () => screen.getByRole("heading", { name: "Resolved" }).closest("section")!;

describe("SessionGrid's Resolved group", () => {
  it("lists every session under Resolved when all of them resolved", () => {
    render(
      <SessionGrid
        sessions={[summary("1", "First talks", { resolved: true }), summary("2", "Second talks", { resolved: true })]}
      />,
    );

    const group = within(resolvedGroup());
    expect(group.getAllByRole("link")).toHaveLength(2);
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("lists a resolved session whose resolution date could not be read under Resolved", () => {
    render(
      <SessionGrid sessions={[summary("1", "Undated talks", { resolved: true }, null), summary("2", "Open talks")]} />,
    );

    expect(within(resolvedGroup()).getByRole("link", { name: /Undated talks/ })).toBeInTheDocument();
    expect(within(resolvedGroup()).queryByRole("link", { name: /Open talks/ })).toBeNull();
  });

  it("shows no Resolved heading when no session resolved", () => {
    render(<SessionGrid sessions={[summary("1", "Open talks", { resolved: false }), summary("2", "Unread talks")]} />);

    expect(screen.queryByRole("heading", { name: "Resolved" })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("says a session's status is unknown where its resolution could not be read, outside the Resolved group", () => {
    render(
      <SessionGrid
        sessions={[
          summary("1", "Unread talks", { resolutionUnknown: true }),
          summary("2", "Done talks", { resolved: true }),
        ]}
      />,
    );

    const card = screen.getByRole("link", { name: /Unread talks/ });
    expect(within(card).getByText("Status unknown")).toBeInTheDocument();
    expect(within(resolvedGroup()).queryByRole("link", { name: /Unread talks/ })).toBeNull();
    expect(within(screen.getByRole("link", { name: /Done talks/ })).queryByText("Status unknown")).toBeNull();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SessionResults } from "@/features/resolution/utils/sessionResults";
import type { SessionOption } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { GATEWAY } from "@/testing/fixtures";

import { SessionHeader } from "../SessionHeader";

const session = toSessionDetail({ ...sessionDetailColumns, children: [sessionChildRow()] }, GATEWAY);

function renderHeader(results: SessionResults<SessionOption>) {
  render(
    <SessionHeader
      session={session}
      status="resolved"
      stats={undefined}
      statsPending={false}
      poolBalances={undefined}
      poolBalancesPending={false}
      usdPrice={undefined}
      results={results}
    />,
  );
  return screen.getByRole("heading", { level: 1 }).closest("header") as HTMLElement;
}

describe("SessionHeader on a resolved session", () => {
  it("reads an INVALID parent as Invalid, with what each of its tokens pays", () => {
    const header = renderHeader({
      invalidPayouts: "Pays per token: each option 0, INVALID 1",
      winners: [],
      options: {},
    });

    expect(header).toHaveTextContent("Invalid");
    expect(header).toHaveTextContent("Pays per token: each option 0, INVALID 1");
  });

  it("lists a winner whose answer is still being read without a value", () => {
    const [option] = session.options;
    const header = renderHeader({
      invalidPayouts: null,
      winners: [option!],
      options: { [option!.market.toLowerCase()]: { kind: "loading" } },
    });

    expect(header).toHaveTextContent(option!.name);
    expect(header).toHaveTextContent("Selected option");
    expect(header.querySelector("[aria-busy]")).not.toBeNull();
  });
});

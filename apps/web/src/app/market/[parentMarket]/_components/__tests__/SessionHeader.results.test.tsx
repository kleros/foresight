import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SessionResults } from "@/features/resolution/utils/sessionResults";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { addresses, GATEWAY } from "@/testing/fixtures";

import { SessionHeader } from "../SessionHeader";

const session = toSessionDetail({ ...sessionDetailColumns, children: [sessionChildRow()] }, GATEWAY);
const market = addresses.childMarkets[0].toLowerCase();
const optionName = session.options[0]!.name;

function renderHeader(results: SessionResults) {
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
  return screen.getByRole("heading", { level: 1 }).closest("header")!;
}

describe("SessionHeader on a resolved session", () => {
  it("states what the parent's INVALID token pays", () => {
    const header = renderHeader({
      invalid: [{ token: "the INVALID token", pays: 10n ** 18n }],
      options: { [market]: { kind: "invalid", payouts: [] } },
    });

    expect(header).toHaveTextContent("Invalid: the INVALID token pays 1 sDAI.");
  });

  it("reads a winner whose child has not resolved as Waiting for result", () => {
    const header = renderHeader({ invalid: null, options: { [market]: { kind: "waiting" } } });

    expect(header).toHaveTextContent(`${optionName}Waiting for result`);
    expect(header).not.toHaveTextContent("Invalid");
  });

  it("reads a winner whose child resolved INVALID as Invalid, not as waiting", () => {
    const header = renderHeader({
      invalid: null,
      options: { [market]: { kind: "invalid", payouts: [{ token: "INVALID", pays: 10n ** 18n }] } },
    });

    expect(header).toHaveTextContent(`${optionName}Invalid`);
    expect(header).not.toHaveTextContent("Waiting for result");
  });

  it("lists a winner whose child is still being read with no claim about its result", () => {
    const header = renderHeader({ invalid: null, options: { [market]: { kind: "pending" } } });

    expect(header).toHaveTextContent(optionName);
    expect(header).not.toHaveTextContent(/Could not read|Waiting for result|Invalid/);
  });
});

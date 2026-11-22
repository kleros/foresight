import { describe, expect, it } from "vitest";

import { STATUS_REASON, stopsSends } from "../statusReason";

const UNKNOWN = /Couldn't check whether this session has resolved/;

describe("STATUS_REASON", () => {
  it("says the session resolved, not that its resolution could not be checked", () => {
    expect(STATUS_REASON.resolved).toMatch(/has resolved/);
    expect(STATUS_REASON.resolved).not.toMatch(UNKNOWN);
  });

  it("says the resolution could not be checked", () => {
    expect(STATUS_REASON.unknown).toMatch(UNKNOWN);
  });
});

describe("stopsSends", () => {
  it.each([
    ["resolved", true],
    ["unknown", true],
    ["trading", false],
    ["closed", false],
    ["setting-up", false],
  ] as const)("%s: %s", (status, stops) => {
    expect(stopsSends(status)).toBe(stops);
  });
});

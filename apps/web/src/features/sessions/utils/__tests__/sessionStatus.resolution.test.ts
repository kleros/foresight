import { describe, expect, it } from "vitest";

import { sessionStatus } from "../toSessionDetail";

const at = new Date(1756900800 * 1000);

describe("sessionStatus with the parent's resolution read", () => {
  it.each([true, false, undefined])(
    "reads a resolved parent as resolved before setup has finished, liquidity %s",
    (liquid) => {
      expect(sessionStatus({ setupComplete: false, closesAt: at }, at, liquid, { resolved: true })).toBe("resolved");
    },
  );

  it("keeps an unfinished session setting up when its resolution read fails", () => {
    expect(sessionStatus({ setupComplete: false, closesAt: at }, at, true, new Error("HTTP request failed"))).toBe(
      "setting-up",
    );
  });

  it("reads a failed read as unknown past the date over empty pools, not closed", () => {
    const after = new Date(at.getTime() + 86_400_000);
    expect(sessionStatus({ setupComplete: true, closesAt: at }, after, false, new Error("HTTP request failed"))).toBe(
      "unknown",
    );
  });

  it("leaves an unread resolution as the pools and the date say", () => {
    expect(sessionStatus({ setupComplete: true, closesAt: at }, at, true, undefined)).toBe("trading");
  });
});

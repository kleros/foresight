import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { sessionStatus } from "../toSessionDetail";

/** sessionStatus's fourth argument is `{ resolved }` from the resolution read, or the Error that read rejected with. */
describe("A6 a failed resolution read reads as unknown", () => {
  const at = new Date(1756900800 * 1000);
  const failure = new Error("HTTP request failed");

  it.each([
    ["before the resolution date, pools live", -1, true],
    ["before the resolution date, pools unread", -1, undefined],
    ["after the resolution date, pools empty", 86_400_000, false],
    ["after the resolution date, pools live", 86_400_000, true],
  ] as const)("%s", (_, offset, liquid) => {
    expect(sessionStatus({ setupComplete: true, closesAt: at }, new Date(at.getTime() + offset), liquid, failure)).toBe(
      "unknown",
    );
  });

  it("for any resolution date, clock or liquidity read of a set-up session", () => {
    const instant = fc.integer({ min: 0, max: 4102444800 }).map((seconds) => new Date(seconds * 1000));
    fc.assert(
      fc.property(
        fc.option(instant, { nil: null }),
        instant,
        fc.constantFrom(true, false, undefined),
        (closesAt, now, liquid) => {
          expect(sessionStatus({ setupComplete: true, closesAt }, now, liquid, failure)).toBe("unknown");
        },
      ),
    );
  });

  it("whatever the error says", () => {
    fc.assert(
      fc.property(fc.string(), (message) => {
        expect(sessionStatus({ setupComplete: true, closesAt: at }, at, true, new Error(message))).toBe("unknown");
      }),
    );
  });
});

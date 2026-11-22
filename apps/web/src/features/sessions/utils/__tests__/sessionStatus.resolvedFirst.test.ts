import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { sessionStatus } from "../toSessionDetail";

describe("sessionStatus ranks the parent's resolution above setup", () => {
  const instant = fc.integer({ min: 0, max: 4102444800 }).map((seconds) => new Date(seconds * 1000));

  it("reads Resolved for a session whose setup never finished", () => {
    fc.assert(
      fc.property(
        fc.option(instant, { nil: null }),
        instant,
        fc.constantFrom(true, false, undefined),
        (closesAt, now, liquid) => {
          expect(sessionStatus({ setupComplete: false, closesAt }, now, liquid, { resolved: true })).toBe("resolved");
        },
      ),
    );
  });

  it("reads unknown for a session whose setup never finished when the read failed", () => {
    expect(sessionStatus({ setupComplete: false, closesAt: null }, new Date(0), undefined, new Error("x"))).toBe(
      "unknown",
    );
  });

  it("keeps the rule it had while the read is still out", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.option(instant, { nil: null }),
        instant,
        fc.constantFrom(true, false, undefined),
        (setupComplete, closesAt, now, liquid) => {
          const detail = { setupComplete, closesAt };
          expect(sessionStatus(detail, now, liquid, undefined)).toBe(sessionStatus(detail, now, liquid));
        },
      ),
    );
  });
});

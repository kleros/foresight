import { describe, expect, it } from "vitest";

import { formatUtcInstant, utcInstant } from "../date";

describe("utcInstant", () => {
  it("composes an ISO day and HH:mm into a UTC date", () => {
    expect(utcInstant("2026-08-20", "12:00")?.toISOString()).toBe("2026-08-20T12:00:00.000Z");
  });

  it("defaults a missing time to midnight", () => {
    expect(utcInstant("2026-08-20", "")?.toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });

  it("returns null for a missing day", () => {
    expect(utcInstant("", "12:00")).toBeNull();
  });

  it("returns null for an unparseable day", () => {
    expect(utcInstant("not-a-day", "12:00")).toBeNull();
  });
});

describe("formatUtcInstant", () => {
  it("formats day, month, year and 24-hour time in UTC", () => {
    expect(formatUtcInstant(utcInstant("2026-08-20", "12:00"))).toBe("20 Aug 2026, 12:00 UTC");
  });

  it("keeps midnight at 00:00", () => {
    expect(formatUtcInstant(utcInstant("2026-08-20", "00:00"))).toBe("20 Aug 2026, 00:00 UTC");
  });

  it("returns 'not set' for null", () => {
    expect(formatUtcInstant(null)).toBe("not set");
  });
});

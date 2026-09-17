import { describe, expect, it } from "vitest";

import { fileStamp, formatUtcInstant, utcInstant } from "../date";

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

  it("returns null for a day outside the calendar", () => {
    expect(utcInstant("2026-13-45", "12:00")).toBeNull();
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

describe("formatLocalInstant", () => {
  // Built in the reader's zone, so what comes back is that same clock time whatever the zone.
  it("shows the moment in the reader's zone and names the zone", () => {
    expect(formatLocalInstant(new Date(2026, 7, 20, 18, 0, 0))).toMatch(/^20 Aug 2026, 18:00 \S/);
  });

  it("keeps midnight at 00:00", () => {
    expect(formatLocalInstant(new Date(2026, 7, 20, 0, 0, 0))).toMatch(/^20 Aug 2026, 00:00 \S/);
  });

  it("returns 'not set' for null", () => {
    expect(formatLocalInstant(null)).toBe("not set");
  });
});

describe("fileStamp", () => {
  it("writes the local date and time with only filename-safe characters", () => {
    expect(fileStamp(new Date(2026, 8, 5, 9, 7))).toBe("2026-09-05_09-07");
  });
});

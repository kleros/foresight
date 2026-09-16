// Pinned so every conversion below is a concrete number. vitest's forks pool
// gives this file its own process, so nothing else sees it.
process.env.TZ = "Asia/Kolkata";

import { getLocalTimeZone, parseDate, parseDateTime, today } from "@internationalized/date";
import { describe, expect, it } from "vitest";

import { closeOnFirstPick, firstPickDefault, splitCalendarValue, toCalendarValue } from "../calendarValue";

describe("toCalendarValue, in GMT+5:30", () => {
  it("shows a UTC day and time as the creator's own", () => {
    expect(toCalendarValue("2026-08-20", "09:30")?.toString()).toBe("2026-08-20T15:00:00");
  });

  it("moves to the next day when the offset carries it over midnight", () => {
    expect(toCalendarValue("2026-08-20", "22:00")?.toString()).toBe("2026-08-21T03:30:00");
  });

  it("reads a missing time as UTC midnight", () => {
    expect(toCalendarValue("2026-08-20", "")?.toString()).toBe("2026-08-20T05:30:00");
  });

  it("returns null for a missing day", () => {
    expect(toCalendarValue("", "09:30")).toBeNull();
  });

  it("returns null for an unparseable day", () => {
    expect(toCalendarValue("not-a-day", "09:30")).toBeNull();
  });

  it("returns null for a day outside the calendar", () => {
    expect(toCalendarValue("2026-13-45", "09:30")).toBeNull();
  });
});

describe("splitCalendarValue, in GMT+5:30", () => {
  it("stores what was picked as a UTC day and time", () => {
    expect(splitCalendarValue(parseDateTime("2026-08-20T15:00"))).toEqual({ day: "2026-08-20", time: "09:30" });
  });

  it("moves back a day when the offset carries it over midnight", () => {
    expect(splitCalendarValue(parseDateTime("2026-08-21T03:30"))).toEqual({ day: "2026-08-20", time: "22:00" });
  });

  it("reads a day alone as that day's local midnight", () => {
    expect(splitCalendarValue(parseDate("2026-08-20"))).toEqual({ day: "2026-08-19", time: "18:30" });
  });

  it("empties both fields when the picker has no value", () => {
    expect(splitCalendarValue(null)).toEqual({ day: "", time: "" });
  });
});

describe("the seam as a whole", () => {
  it("hands back exactly the UTC day and time it was shown", () => {
    for (const [day, time] of [
      ["2026-08-20", "09:30"],
      ["2026-08-20", "22:00"],
      ["2026-12-31", "23:59"],
    ] as const) {
      expect(splitCalendarValue(toCalendarValue(day, time))).toEqual({ day, time });
    }
  });
});

describe("closeOnFirstPick", () => {
  it("closes the popover while the draft has no day, which is what lands the pick", () => {
    expect(closeOnFirstPick("")()).toBe(true);
  });

  it("leaves it open once a day is set, because the pick then carries a time", () => {
    expect(closeOnFirstPick("2026-09-25")()).toBe(false);
  });
});

describe("firstPickDefault", () => {
  it("lands on today in the creator's zone", () => {
    expect(firstPickDefault().toString().slice(0, 10)).toBe(today(getLocalTimeZone()).toString());
  });

  it("is timed at noon", () => {
    expect(firstPickDefault().toString().slice(-8)).toBe("12:00:00");
  });
});

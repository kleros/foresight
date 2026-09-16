import {
  type CalendarDateTime,
  type DateValue,
  fromDate,
  getLocalTimeZone,
  toCalendarDateTime,
  today,
  toZoned,
} from "@internationalized/date";

import { utcInstant } from "@/utils/date";

/**
 * The draft stores its closing times as a UTC day and clock time. The picker
 * shows and edits them in the creator's time zone; these two cross that seam.
 */

/** @param day `YYYY-MM-DD` @param time `HH:mm`, both UTC, time empty for midnight. */
export function toCalendarValue(day: string, time: string): CalendarDateTime | null {
  const instant = utcInstant(day, time);
  return instant ? toCalendarDateTime(fromDate(instant, getLocalTimeZone())) : null;
}

/** A picker value back as the draft's UTC day and clock time. A day alone is its local midnight. */
export function splitCalendarValue(value: DateValue | null): { day: string; time: string } {
  if (!value) return { day: "", time: "" };
  const iso = toZoned(value, getLocalTimeZone()).toDate().toISOString();
  return { day: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/**
 * The picker holds a calendar pick carrying no time instead of committing it,
 * so until the draft has a day, a pick only lands by closing the popover.
 */
export const closeOnFirstPick = (day: string) => () => !day;

/** The earliest moment the picker may offer, in the creator's time zone. */
export function localNow(now: Date): CalendarDateTime {
  return toCalendarDateTime(fromDate(now, getLocalTimeZone()));
}

/** What a first calendar pick is timed at, and what Clear resets to: noon today, creator's zone. */
export function firstPickDefault(): CalendarDateTime {
  return toCalendarDateTime(today(getLocalTimeZone())).set({ hour: 12 });
}

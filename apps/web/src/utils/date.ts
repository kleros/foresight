/**
 * Human-readable time remaining until an ISO 8601 instant.
 *
 * @example
 * timeLeftUntil("2026-10-29T09:52:08.580Z");
 * // "in 42 secs" | "in 3 mins" | "in 5 hrs" | "after October 29, 2026"
 */
export function timeLeftUntil(isoString: string): string {
  const targetDate = new Date(isoString);
  const timeDifference = targetDate.getTime() - Date.now();

  if (Number.isNaN(timeDifference) || timeDifference <= 0) return "now";

  const secondsLeft = Math.floor(timeDifference / 1000);
  const minutesLeft = Math.floor(secondsLeft / 60);
  const hoursLeft = Math.floor(minutesLeft / 60);
  const daysLeft = Math.floor(hoursLeft / 24);

  if (secondsLeft < 60) return `in ${secondsLeft} sec${secondsLeft > 1 ? "s" : ""}`;
  if (minutesLeft < 60) return `in ${minutesLeft} min${minutesLeft > 1 ? "s" : ""}`;
  if (hoursLeft < 24) return `in ${hoursLeft} hr${hoursLeft > 1 ? "s" : ""}`;
  if (daysLeft < 2) return `in ${daysLeft} day${daysLeft > 1 ? "s" : ""}`;

  return `after ${targetDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`;
}

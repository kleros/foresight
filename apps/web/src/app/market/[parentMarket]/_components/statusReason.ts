import type { SessionStatus } from "@/features/sessions/types";

/** Statuses under which no new prediction transaction is sent, even by a run already going. */
export type SendsStopped = Extract<SessionStatus, "resolved" | "unknown">;

export const stopsSends = (status: SessionStatus): status is SendsStopped =>
  status === "resolved" || status === "unknown";

/** Why Predict is off under each of them; the card, the popup and the option cards say it. */
export const STATUS_REASON: Record<SendsStopped, string> = {
  resolved: "This session has resolved. It takes no new predictions.",
  unknown: "Couldn't check whether this session has resolved. Trying again.",
};

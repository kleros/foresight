import type { StatusTone } from "@/components/ui/StatusChip";

import type { SessionStatus } from "../types";

/** One chip vocabulary per session status; "Closed" matches the homepage filter label. */
export const statusChip: Record<SessionStatus, { tone: StatusTone; label: string }> = {
  trading: { tone: "done", label: "Trading" },
  "setting-up": { tone: "attention", label: "Setting up" },
  closed: { tone: "none", label: "Closed" },
};

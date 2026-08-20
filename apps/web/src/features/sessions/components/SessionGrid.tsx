import clsx from "clsx";

import type { SessionSummary } from "../types";
import { SessionCard } from "./SessionCard";

export function SessionGrid({ sessions, stale }: { sessions: SessionSummary[]; stale?: boolean }) {
  return (
    <div className={clsx("fs-session-grid", stale && "fs-session-grid--stale")} aria-busy={stale || undefined}>
      {sessions.map((session) => (
        <div key={session.id} className="fs-rise">
          <SessionCard session={session} />
        </div>
      ))}
    </div>
  );
}

import clsx from "clsx";

import type { SessionSummary } from "../types";
import { SessionCard } from "./SessionCard";

/** Sessions whose parent market resolved are listed apart, under the ones still trading. */
export function SessionGrid({ sessions, stale }: { sessions: SessionSummary[]; stale?: boolean }) {
  const open = sessions.filter((session) => session.resolved !== true);
  const resolved = sessions.filter((session) => session.resolved === true);

  return (
    <div className={clsx("flex flex-col gap-10", stale && "fs-session-grid--stale")} aria-busy={stale || undefined}>
      {open.length > 0 ? <Cards sessions={open} /> : null}
      {resolved.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-fs-text-primary text-base font-semibold">Resolved</h2>
          <Cards sessions={resolved} />
        </section>
      ) : null}
    </div>
  );
}

function Cards({ sessions }: { sessions: SessionSummary[] }) {
  return (
    <div className="fs-session-grid">
      {sessions.map((session) => (
        <div key={session.id} className="fs-rise">
          <SessionCard session={session} />
        </div>
      ))}
    </div>
  );
}

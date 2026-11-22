import clsx from "clsx";

import type { SessionSummary } from "../types";
import { SessionCard } from "./SessionCard";

export function SessionGrid({ sessions, stale }: { sessions: SessionSummary[]; stale?: boolean }) {
  const resolved = sessions.filter((session) => session.resolved);
  const rest = sessions.filter((session) => !session.resolved);

  return (
    <div className={clsx(stale && "fs-session-grid--stale")} aria-busy={stale || undefined}>
      {rest.length > 0 ? <Cards sessions={rest} /> : null}
      {resolved.length > 0 ? (
        <section className={clsx(rest.length > 0 && "pt-10")}>
          <h2 className="text-fs-text-primary pb-4 text-base font-semibold">Resolved</h2>
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

"use client";

import { useState } from "react";

import { Button, StandardPagination } from "@kleros/ui-components-library";

import { sessionKey, useParentResolutions } from "@/features/resolution/api/useSessionResolution";
import { useWinningOptionNames } from "@/features/resolution/api/useWinningOptionNames";
import { useSessions } from "@/features/sessions/api/getSessions";
import { SessionFilters } from "@/features/sessions/components/SessionFilters";
import { SessionGrid } from "@/features/sessions/components/SessionGrid";
import { SessionGridSkeleton } from "@/features/sessions/components/SessionGridSkeleton";
import {
  clearLabel,
  emptyCopy,
  isFiltered,
  NO_FILTERS,
  pageCount,
  PER_PAGE,
  type SessionFilters as Filters,
} from "@/features/sessions/utils/listing";

import { sessionFactoryAddress } from "@/config/contracts";

const plural = (count: number) => (count === 1 ? "session" : "sessions");

export function SessionBrowser() {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);

  const { data, isPending, isError, isPlaceholderData } = useSessions({ page, filters });

  const listed = data?.sessions ?? [];
  const sessionFactory = sessionFactoryAddress();
  const resolutions = useParentResolutions(listed.map((session) => sessionKey(session.id, sessionFactory)));
  const winners = useWinningOptionNames(
    listed.map((session, index) => ({ id: session.id, parent: resolutions[index] })),
  );
  const sessions = listed.map((session, index) => {
    const parent = resolutions[index];
    if (parent === undefined) return session;
    return parent instanceof Error
      ? { ...session, resolutionUnknown: true }
      : { ...session, resolved: parent.resolved, winningOptionNames: winners[index] };
  });
  const filtered = isFiltered(filters);

  /** Exact only unfiltered: neither a search nor open/closed has an aggregate. */
  const pages = filtered ? (data?.hasNextPage ? page + 1 : page) : pageCount(data?.total ?? 0);

  const changeFilters = (next: Filters) => {
    setFilters(next);
    setPage(1);
  };

  const clearFilters = () => changeFilters(NO_FILTERS);

  const firstOnPage = (page - 1) * PER_PAGE;
  const matchedSoFar = firstOnPage + sessions.length;
  /** Null where there is nothing to count: the empty card already says so. */
  const resultRange = filtered
    ? `${matchedSoFar}${data?.hasNextPage ? "+" : ""} matching ${plural(matchedSoFar)}`
    : sessions.length === 0
      ? null
      : `${firstOnPage + 1}–${matchedSoFar} of ${data?.total ?? 0} ${plural(data?.total ?? 0)}`;

  const status = isPending ? "Loading sessions" : resultRange;
  const empty = emptyCopy(filters);

  return (
    <div className="mx-auto w-full max-w-294">
      <section className="sticky top-16 z-9 py-2.5">
        <SessionFilters filters={filters} onChange={changeFilters} />
      </section>

      {status || filtered ? (
        <div className="flex items-baseline justify-between gap-4 pt-3.5 pb-4">
          <div className="type-label text-fs-text-secondary">{status}</div>
          {filtered ? (
            <button type="button" onClick={clearFilters} className="type-label text-fs-accent cursor-pointer">
              {clearLabel(filters)}
            </button>
          ) : null}
        </div>
      ) : null}

      {isPending ? <SessionGridSkeleton /> : null}

      {isError ? (
        <p className="type-body text-fs-text-secondary border-fs-border rounded-fs border p-13 text-center">
          Could not load sessions. Try again in a moment.
        </p>
      ) : null}

      {!isPending && !isError && sessions.length > 0 ? (
        <>
          <SessionGrid
            key={sessions.map((session) => session.id).join()}
            sessions={sessions}
            stale={isPlaceholderData}
          />
          {pages > 1 ? (
            <div className="flex justify-center pt-8">
              <StandardPagination currentPage={page} numPages={pages} callback={setPage} />
            </div>
          ) : null}
        </>
      ) : null}

      {!isPending && !isError && sessions.length === 0 ? (
        <div className="border-fs-border bg-fs-surface rounded-fs border px-6 py-13 text-center">
          <div className="text-fs-text-primary text-base leading-5.5 font-semibold">{empty.title}</div>
          <p className="type-body text-fs-text-secondary pt-1.5">{empty.hint}</p>
          {filtered ? (
            <div className="flex justify-center pt-4.5">
              <Button text={clearLabel(filters)} variant="secondary" small onPress={clearFilters} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

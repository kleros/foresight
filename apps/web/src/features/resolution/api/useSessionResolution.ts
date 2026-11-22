"use client";

import { queryOptions, skipToken, useQueries, useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

import { STALE_TIME } from "@/lib/query";
import { publicClient } from "@/lib/web3/public-client";

import { fetchSessionResolution, type ParentResolution, type SessionResolution } from "./getSessionResolution";

export interface SessionResolutionRead {
  sessionFactory: Address;
  sessionId: bigint;
  /** The child markets the session holds. */
  childMarkets: readonly Address[];
}

/** Each read's value, or the Error its latest attempt failed with; undefined while unread. */
export interface SessionResolutionState {
  parent: ParentResolution | Error | undefined;
  children: SessionResolution["children"] | Error | undefined;
  /** Reads the parent again now; undefined until the session is known. */
  recheckParent: (() => Promise<ParentResolution | Error>) | undefined;
}

const REREAD_MS = 30_000;

/** A failed attempt resolves to its Error, so it replaces a cached answer instead of sitting beside it. */
async function settled<T>(read: Promise<T>): Promise<T | Error> {
  try {
    return await read;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/** bigint is not JSON, which the query key hash needs. */
const sessionKey = (read: Pick<SessionResolutionRead, "sessionFactory" | "sessionId"> | undefined) =>
  read && [read.sessionFactory.toLowerCase(), String(read.sessionId)];

/** The parent's own read; a resolved parent is final, anything else is read again. */
export function parentResolutionQuery(read: Pick<SessionResolutionRead, "sessionFactory" | "sessionId"> | undefined) {
  return queryOptions({
    queryKey: ["session-resolution", "parent", sessionKey(read)],
    queryFn: read
      ? () =>
          settled(
            fetchSessionResolution(publicClient, {
              sessionFactory: read.sessionFactory,
              sessionId: read.sessionId,
              parentOutcomes: [],
            }).then((result) => result.parent),
          )
      : skipToken,
    staleTime: STALE_TIME.live,
    refetchOnWindowFocus: false,
    refetchInterval: ({ state }) => (state.data instanceof Error || !state.data?.resolved ? REREAD_MS : false),
  });
}

const allResolved = (children: SessionResolution["children"] | Error | undefined) =>
  children !== undefined &&
  !(children instanceof Error) &&
  Object.values(children).every((child) => child?.deployed && child.resolved);

/** The parent and the children are read apart, so the parent's status never waits on or fails with a child read. */
export function useSessionResolution(read: SessionResolutionRead | undefined): SessionResolutionState {
  const parent = useQuery(parentResolutionQuery(read));
  const children = useQuery({
    queryKey: [
      "session-resolution",
      "children",
      sessionKey(read),
      read?.childMarkets.map((market) => market.toLowerCase()),
    ],
    queryFn: read
      ? () =>
          settled(
            fetchSessionResolution(publicClient, {
              sessionFactory: read.sessionFactory,
              sessionId: read.sessionId,
            }).then((result) => result.children),
          )
      : skipToken,
    staleTime: STALE_TIME.live,
    refetchOnWindowFocus: false,
    refetchInterval: ({ state }) => (allResolved(state.data) ? false : REREAD_MS),
  });
  const { refetch } = parent;

  return {
    parent: parent.data,
    children: children.data,
    recheckParent: read
      ? async () => (await refetch()).data ?? new Error("The resolution read returned nothing.")
      : undefined,
  };
}

/** Each session's parent resolution, in order; undefined while unread or where the session is not read. */
export function useParentResolutions(
  reads: ReadonlyArray<Pick<SessionResolutionRead, "sessionFactory" | "sessionId"> | undefined>,
): Array<ParentResolution | Error | undefined> {
  return useQueries({
    queries: reads.map((read) => parentResolutionQuery(read)),
    combine: (results) => results.map((result) => result.data),
  });
}

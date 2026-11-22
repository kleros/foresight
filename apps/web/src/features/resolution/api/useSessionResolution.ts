"use client";

import { queryOptions, skipToken, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
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

export type SessionKey = Pick<SessionResolutionRead, "sessionFactory" | "sessionId">;

/** Each read's value, or the Error its latest attempt failed with; undefined while unread. */
export interface SessionResolutionState {
  parent: ParentResolution | Error | undefined;
  children: SessionResolution["children"] | Error | undefined;
  /** Reads the parent again now, past any cached answer; undefined until the session is known. */
  recheckParent: (() => Promise<ParentResolution | Error>) | undefined;
}

/** The factory's session `id` names; undefined for an id the factory does not number, or with no factory. */
export function sessionKey(id: string, sessionFactory: Address | null): SessionKey | undefined {
  return sessionFactory && /^\d+$/.test(id) ? { sessionFactory, sessionId: BigInt(id) } : undefined;
}

/** How often, in ms, a read that has not settled on resolved is made again. */
const REREAD_MS = 30_000;

/** bigint is not JSON, which the query key hash needs. */
const sessionPart = ({ sessionFactory, sessionId }: SessionKey) => [sessionFactory.toLowerCase(), String(sessionId)];

export const sessionResolutionKeys = {
  all: ["session-resolution"] as const,
  parent: (session: SessionKey) => [...sessionResolutionKeys.all, "parent", ...sessionPart(session)] as const,
  children: (read: SessionResolutionRead) =>
    [
      ...sessionResolutionKeys.all,
      "children",
      ...sessionPart(read),
      read.childMarkets.map((market) => market.toLowerCase()),
    ] as const,
};

/** A failed attempt resolves to its Error, so it replaces a cached answer instead of hiding behind it. */
async function settled<T>(read: Promise<T>): Promise<T | Error> {
  try {
    return await read;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

const isResolvedParent = (data: ParentResolution | Error | undefined) =>
  !(data instanceof Error) && data?.resolved === true;

const allChildrenResolved = (data: SessionResolution["children"] | Error | undefined) =>
  data !== undefined &&
  !(data instanceof Error) &&
  Object.values(data).every((child) => child?.deployed === true && child.resolved);

/** The parent's own read, with no child market in it; a resolved parent is final and read no more. */
export function parentResolutionQuery(session: SessionKey | undefined) {
  return queryOptions({
    queryKey: session ? sessionResolutionKeys.parent(session) : [...sessionResolutionKeys.all, "parent"],
    queryFn: session
      ? () =>
          settled(
            fetchSessionResolution(publicClient, { ...session, parentOutcomes: [] }).then((result) => result.parent),
          )
      : skipToken,
    staleTime: STALE_TIME.live,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (isResolvedParent(query.state.data) ? false : REREAD_MS),
  });
}

/** The parent and its children are read apart, so the parent's answer never waits on or fails with a child read. */
export function useSessionResolution(read: SessionResolutionRead | undefined): SessionResolutionState {
  const queryClient = useQueryClient();
  const parent = useQuery(parentResolutionQuery(read));
  const children = useQuery({
    queryKey: read ? sessionResolutionKeys.children(read) : [...sessionResolutionKeys.all, "children"],
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
    refetchInterval: (query) => (allChildrenResolved(query.state.data) ? false : REREAD_MS),
  });

  return {
    parent: parent.data,
    children: children.data,
    recheckParent: read ? () => queryClient.fetchQuery({ ...parentResolutionQuery(read), staleTime: 0 }) : undefined,
  };
}

/** Each session's parent resolution, in the order given; undefined while unread or where no session is given. */
export function useParentResolutions(
  sessions: ReadonlyArray<SessionKey | undefined>,
): Array<ParentResolution | Error | undefined> {
  return useQueries({
    queries: sessions.map((session) => parentResolutionQuery(session)),
    combine: (results) => results.map((result) => result.data),
  });
}

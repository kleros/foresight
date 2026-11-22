"use client";

import type { Address } from "viem";

import type { ParentResolution, SessionResolution } from "./getSessionResolution";

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
}

export function useSessionResolution(read: SessionResolutionRead | undefined): SessionResolutionState {
  void read;
  throw new Error("not implemented");
}

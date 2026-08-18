import type { GraphqlFetch } from "@/lib/graphql/batcher";
import { graphql } from "@/lib/graphql/generated";

import type { SessionDeploySnapshot } from "../flow/types";

/**
 * Waiting for the subgraph to catch up with a session that is already on chain.
 */

export const INDEXED_ATTEMPTS = 15;
export const INDEXED_DELAY_MS = 1_000;

const SESSION_INDEXED = graphql(`
  query SessionIndexed($id: String!) {
    Session(where: { id: { _eq: $id } }, limit: 1) {
      id
      children {
        id
      }
    }
  }
`);

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resolves once the subgraph holds the session and every branch it created.
 * Rejects when it never does, which the caller reads as "no answer", not "no session".
 */
export function createIndexedProbe(
  fetch: GraphqlFetch,
  opts: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): (snapshot: SessionDeploySnapshot) => Promise<void> {
  const attempts = opts.attempts ?? INDEXED_ATTEMPTS;
  const delayMs = opts.delayMs ?? INDEXED_DELAY_MS;
  const sleep = opts.sleep ?? wait;

  return async (snapshot) => {
    if (snapshot.sessionId === undefined) {
      throw new Error("The session cannot be waited for: it was never created.");
    }
    const id = String(snapshot.sessionId);
    const branches = snapshot.deploy.children.length;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const session = await fetch(SESSION_INDEXED, { id }).then(
        (result) => result.Session[0],
        () => undefined,
      );
      if (session && session.children.length >= branches) return;
      if (attempt < attempts) await sleep(delayMs);
    }

    throw new Error(`The session has not appeared after ${attempts} attempts.`);
  };
}

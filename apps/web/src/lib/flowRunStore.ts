import { createFlowRunStore, createMemoryStorage, fromWebStorage, type FlowRunStore } from "@foresight/tx-orchestrator";

/**
 * Where an unfinished transaction flow is kept so a closed tab does not lose it. Server renders
 * get a store that forgets, since there is no tab to come back to.
 */
export function createRunStore(): FlowRunStore {
  const storage = typeof window === "undefined" ? createMemoryStorage() : fromWebStorage(window.localStorage);
  return createFlowRunStore({ storage });
}

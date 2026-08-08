import { decodeState, encodeState } from "./codec";
import {
  DEFAULT_RUN_TTL_MS,
  FLOW_RUN_SCHEMA_VERSION,
  type PersistedFlowRun,
  type PersistedFlowRunInput,
} from "./types";

/**
 * Where incomplete runs live between visits.
 */
export interface FlowRunStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** `Storage` hides enumeration behind `length`/`key(i)`; the gate needs it. */
  keys(): string[];
}

export interface FlowRunStore {
  save<TSnapshot, TCtx>(run: PersistedFlowRunInput<TSnapshot, TCtx>): void;
  /** `null` if absent, expired or unreadable, bad entry is removed. */
  load<TSnapshot, TCtx>(flowId: string): PersistedFlowRun<TSnapshot, TCtx> | null;
  /** Every live run, expired ones pruned on the way. */
  list<TSnapshot, TCtx>(): PersistedFlowRun<TSnapshot, TCtx>[];
  clear(flowId: string): void;
  clearAll(): void;
}

const DEFAULT_NAMESPACE = "foresight.tx-flow";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A status is not enough: the fields it implies get read straight off it. */
function isStepOutcome(value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (value.status) {
    case "pending":
    case "awaiting-signature":
    case "skipped":
      return true;
    case "submitted":
      return typeof value.hash === "string";
    case "confirmed":
      return typeof value.hash === "string" && typeof value.blockNumber === "bigint";
    default:
      return false;
  }
}

function isStepSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.stepId === "string" &&
    typeof value.label === "string" &&
    isStepOutcome(value.outcome)
  );
}

/** Everything a restore will reach for. Short of this, discard rather than throw later. */
function isUsableRecord(value: unknown): value is PersistedFlowRun<unknown, unknown> {
  if (!isRecord(value)) return false;
  if (typeof value.flowId !== "string" || typeof value.adapterId !== "string") return false;
  if (typeof value.version !== "number" || typeof value.expiresAt !== "number") return false;
  if (typeof value.persistedAt !== "number") return false;
  // Present rather than shaped: their shape belongs to the adapter, not here.
  if (!("snapshot" in value) || !("ctx" in value)) return false;
  if (!Array.isArray(value.steps) || !value.steps.every(isStepSummary)) return false;

  if (value.status === "running") return true;
  if (value.status === "paused") return typeof value.reason === "string";
  if (value.status === "failed") return isRecord(value.error) && typeof value.error.stepId === "string";
  return false;
}

export function createMemoryStorage(): FlowRunStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    keys: () => [...map.keys()],
  };
}

export function fromWebStorage(storage: Storage): FlowRunStorage {
  return {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: (key) => storage.removeItem(key),
    keys: () => Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((k): k is string => k !== null),
  };
}

export function createFlowRunStore(opts: {
  storage: FlowRunStorage;
  namespace?: string;
  ttlMs?: number;
  now?: () => number;
}): FlowRunStore {
  const { storage } = opts;
  const namespace = opts.namespace ?? DEFAULT_NAMESPACE;
  const ttlMs = opts.ttlMs ?? DEFAULT_RUN_TTL_MS;
  const now = opts.now ?? (() => Date.now());

  const keyFor = (flowId: string) => `${namespace}.${flowId}`;
  const ownKeys = () => storage.keys().filter((k) => k.startsWith(`${namespace}.`));

  /** Reads one key, discarding anything unusable. Never throws. */
  function read<TSnapshot, TCtx>(key: string): PersistedFlowRun<TSnapshot, TCtx> | null {
    const raw = storage.getItem(key);
    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = decodeState(raw);
    } catch {
      // Corrupt storage must never be the reason the app fails to boot.
      storage.removeItem(key);
      return null;
    }

    if (!isUsableRecord(parsed) || parsed.version !== FLOW_RUN_SCHEMA_VERSION || now() > parsed.expiresAt) {
      storage.removeItem(key);
      return null;
    }
    if (keyFor(parsed.flowId) !== key) {
      storage.removeItem(key);
      return null;
    }
    return parsed as PersistedFlowRun<TSnapshot, TCtx>;
  }

  return {
    save(run) {
      const persistedAt = now();
      const record: PersistedFlowRun<unknown, unknown> = {
        ...run,
        version: FLOW_RUN_SCHEMA_VERSION,
        persistedAt,
        expiresAt: persistedAt + ttlMs,
      };
      storage.setItem(keyFor(run.flowId), encodeState(record));
    },

    load(flowId) {
      return read(keyFor(flowId));
    },

    list<TSnapshot, TCtx>() {
      const out: PersistedFlowRun<TSnapshot, TCtx>[] = [];
      for (const key of ownKeys()) {
        const run = read<TSnapshot, TCtx>(key);
        if (run) out.push(run);
      }
      return out;
    },

    clear(flowId) {
      storage.removeItem(keyFor(flowId));
    },

    clearAll() {
      for (const key of ownKeys()) storage.removeItem(key);
    },
  };
}

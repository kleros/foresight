import { createFlowScope, type FlowScope } from "../../scope";
import { inFlightEntry, liveEntries, settledEntries } from "../../steps";
import { createFlowRunStore, createMemoryStorage, type FlowRunStorage, type FlowRunStore } from "../../storage";
import type {
  FlowError,
  FlowHooks,
  FlowTx,
  OrchestratorEvent,
  OrchestratorRun,
  PauseReason,
  StepOutcome,
  TxStep,
} from "../../types";
import { createTxOrchestrator, type TxOrchestrator } from "../../orchestrator";
import { createFakeGateway, type FakeGateway, type StepScript } from "./fakeGateway";

/** A stand-in for a real domain snapshot: locked at start, patched from receipts. */
export type TestSnapshot = { title: string; deployed: string[] };
export type TestCtx = { chainId: number; nonce: number };

export const TX: FlowTx = { to: "0x0000000000000000000000000000000000000001" };

export function step(id: string, extra: Partial<TxStep<TestSnapshot, TestCtx>> = {}): TxStep<TestSnapshot, TestCtx> {
  return { id, label: `Step ${id}`, build: () => TX, ...extra };
}

export type Harness = {
  orchestrator: TxOrchestrator<TestSnapshot, TestCtx>;
  gateway: FakeGateway;
  store: FlowRunStore;
  storage: FlowRunStorage;
  scope: FlowScope;
  events: OrchestratorEvent<TestSnapshot, TestCtx>[];
  types: () => string[];
  advance: (ms: number) => void;
  now: () => number;
  start: (steps: TxStep<TestSnapshot, TestCtx>[]) => Promise<void>;
};

export function harness(
  opts: {
    scripts?: StepScript[];
    hooks?: FlowHooks<TestSnapshot, TestCtx>;
    storage?: FlowRunStorage;
    retryAttempts?: number;
    /** Only worth setting to prove one adapter cannot restore another's run. */
    adapterId?: string;
    /** Hold the retry backoff open, to test what happens during it. */
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  } = {},
): Harness {
  const gateway = createFakeGateway(opts.scripts ?? []);
  const storage = opts.storage ?? createMemoryStorage();
  let clock = 1_700_000_000_000;
  const now = () => clock;
  const store = createFlowRunStore({ storage, now });
  const scope = createFlowScope();
  const events: OrchestratorEvent<TestSnapshot, TestCtx>[] = [];

  const orchestrator = createTxOrchestrator<TestSnapshot, TestCtx>({
    adapterId: opts.adapterId ?? "test-flow",
    gateway,
    store,
    scope,
    now,
    hooks: opts.hooks,
    // Backoff is skipped in tests; the retry *count* is the behaviour under test.
    sleep: opts.sleep ?? (async () => {}),
    // Left out unless asked for, so the package's own default is what runs.
    ...(opts.retryAttempts ? { retry: { maxAttempts: opts.retryAttempts } } : {}),
  });

  orchestrator.on("*", (event) => void events.push(event));

  return {
    orchestrator,
    gateway,
    store,
    storage,
    scope,
    events,
    types: () => events.map((e) => e.type),
    advance: (ms) => void (clock += ms),
    now,
    start: (steps) =>
      orchestrator.start({
        flowId: "flow-1",
        snapshot: { title: "Dune", deployed: [] },
        ctx: { chainId: 100, nonce: 1 },
        steps,
      }),
  };
}

/** Lets queued microtasks run without resolving anything the test is holding. */
export async function settle(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Reading a run in a test
//
// The run is a union now, so these keep the assertions about behaviour rather
// than about narrowing.
// ---------------------------------------------------------------------------

type Run = OrchestratorRun<TestSnapshot, TestCtx> | null | undefined;

/** The settled steps themselves, in order. */
export function doneEntries(run: Run) {
  return settledEntries(run?.steps ?? []);
}

/** Ids of the steps that will never run again, in order. */
export function doneIds(run: Run): string[] {
  return settledEntries(run?.steps ?? []).map((entry) => entry.stepId);
}

/** Ids of the steps still owed, in order. */
export function leftIds(run: Run): string[] {
  return liveEntries(run?.steps ?? []).map((entry) => entry.stepId);
}

export function outcomeOf(run: Run, stepId: string): StepOutcome | undefined {
  return run?.steps.find((entry) => entry.stepId === stepId)?.outcome;
}

export function errorOf(run: Run): FlowError | undefined {
  return run?.status === "paused" || run?.status === "failed" ? run.error : undefined;
}

export function reasonOf(run: Run): PauseReason | undefined {
  return run?.status === "paused" ? run.reason : undefined;
}

/** The hash of whatever is on chain right now, if anything. */
export function inFlightHash(run: Run): `0x${string}` | undefined {
  const outcome = inFlightEntry(run?.steps ?? [])?.outcome;
  return outcome?.status === "submitted" ? outcome.hash : undefined;
}

/** The hash, read out of a persisted record rather than a live run. */
export function persistedHash(persisted: { steps: StepSummaryLike[] } | null | undefined): string | undefined {
  const outcome = persisted?.steps.find((entry) => entry.outcome.status === "submitted")?.outcome;
  return outcome?.status === "submitted" ? outcome.hash : undefined;
}

type StepSummaryLike = { stepId: string; label: string; outcome: StepOutcome };

export function persistedIds(persisted: { steps: StepSummaryLike[] } | null | undefined): {
  done: string[];
  left: string[];
} {
  const steps = persisted?.steps ?? [];
  const isDone = (o: StepOutcome) => o.status === "confirmed" || o.status === "skipped";
  return {
    done: steps.filter((entry) => isDone(entry.outcome)).map((entry) => entry.stepId),
    left: steps.filter((entry) => !isDone(entry.outcome)).map((entry) => entry.stepId),
  };
}

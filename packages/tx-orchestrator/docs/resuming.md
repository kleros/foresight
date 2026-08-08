# Resuming

Coming back must never re-send work already on chain, never claim work that did not happen, and never ask for a signature before showing what changed.

## The sequence

```ts
const unfinished = orchestrator.listPersisted();
orchestrator.restore({ flowId, steps: planFor(unfinished[0]) });
const diff = await orchestrator.preflight(); // reads the chain, no wallet opens
await orchestrator.resume();
```

`listPersisted()` returns only this adapter's runs; `restore` would refuse the others anyway.

`restore()` freezes the scope, since a restored run owns the screen until resumed or trashed. Returns `null` when nothing is stored. Throws when the fresh plan lost an unfinished step, or the record belongs to another `adapterId`.

`preflight()` reconciles with the chain, runs `onResume`, and returns the diff: run age, what reconciliation found, what is done, what is left, and adapter-supplied `changes`. It rejects if the chain reads fail, deliberately: there is no retry and no fallback provider here, so supply an RPC you trust and put a retry button behind it. The run stays restored and paused meanwhile, so calling again is safe.

`preflight()` and `reconcileInFlight()` both refuse to run while the loop is going, since they rewrite step outcomes and can overwrite the hash the driver is watching.

## Reconciliation outcomes

`confirmed`: mined while away. Recorded as done, `step:confirmed` fires, `afterStep` runs with the receipt, resume skips it.

`reverted`: mined and failed. The run goes to `failed` and `flow:failed` fires.

`pending`: still in the mempool. Resume adopts the hash rather than paying for a second transaction.

`dropped`: the node has never heard of it. The step returns to `pending` and resume signs a fresh one.

`unknown`: a prompt was open and no hash was recorded. There is nothing to ask the chain, and a dismissed popup is indistinguishable from one approved after the tab died. The step is reset so resume prompts again, and the question is left to that step's `canSkip`. The result carries `canSelfCheck: false` when the step has none.

`none`: nothing was in flight.

## Persistence

One key per run, `foresight.tx-flow.<flowId>` by default, holding the snapshot, context, every step with its outcome, and the phase it stopped in. `encodeState` tags `bigint` so amounts round-trip.

Steps are stored as `{ stepId, label, outcome }` with no builder, which is why `restore` needs a fresh plan.

A store that cannot write does not stop the run. An `inform` fires once saying the run cannot be resumed if the tab closes, and the steps carry on. Stopping would be worse, since resume reads the same storage. The same applies to a store that cannot clear.

Four things drop a stored run on read, each removing the record so the next read is clean:

- `expiresAt` in the past. 72 hours by default, configurable with `ttlMs`.
- A `version` mismatch against `FLOW_RUN_SCHEMA_VERSION`. No migration path, on purpose: a run whose step ids meant something different in an older release could double-send. Bump the constant whenever a stored shape changes meaning.
- Unparseable JSON.
- A record that parses but is unusable: no snapshot, no step list, a paused record with no reason, an unrecognised outcome, a `submitted` step with no hash, a `confirmed` one with no block number, or a record filed under a key that does not match its own `flowId`. A half-written record left in place would throw on every load with no way back.

## Sharing a store between adapters

Storage keys are namespace plus `flowId`, with no `adapterId` in them. Two adapters using one store and the same `flowId` share a key, so `start()` refuses when a record exists, whoever wrote it, and names the owner.

Give each adapter its own store if they need the same ids:

```ts
createFlowRunStore({ storage, namespace: "foresight.tx-flow.vault-deposit" });
```

## Starting over

`start()` refuses when storage holds an unfinished run for that `flowId`. Overwriting it would lose a hash that may be on chain and pay for the work again, and the resume gate is advisory.

```ts
orchestrator.trash(flowId); // no restore needed
await orchestrator.start({ flowId, snapshot, ctx, steps });
```

`trash()` with no argument discards whatever is restored. With no active run and no id it does nothing and announces nothing, since a banner reporting a discard over a record still on disk is worse than no button. It refuses two things: naming one id while a different run is restored, and discarding a record written by another adapter.

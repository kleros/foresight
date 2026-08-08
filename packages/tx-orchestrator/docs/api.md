# API

## createTxOrchestrator(opts)

`adapterId` (required) names the adapter that authored the steps. It is stamped on the run and checked on restore, so one flow type cannot pick up another's run out of shared storage. It is also what `listPersisted()` filters by.

`gateway` (required) is a `TxGateway`, the only door to a chain.

`store` is optional. Leave it out for a memory-only run with no persistence and no resume.

`scope` defaults to a fresh internal one. Pass your own so refetches elsewhere in the app can gate on it.

`hooks` holds `afterStep` and `onResume`.

`confirmations` is passed straight to `waitForReceipt`.

`retry` defaults to three attempts with a backoff of one second, then two, capped at eight. Reads only; a signature is never re-requested silently.

`now` and `sleep` are injected for tests, defaulting to `Date.now` and an abortable `setTimeout`.

`classifyError` defaults to `classifyTxError`. Override it for a wallet with unusual error shapes.

## TxOrchestrator

`start({ flowId, snapshot, ctx, steps })` runs the flow to its next resting state. Throws if a run is already live, paused or failed, if the plan repeats a step id, or if storage already holds an unfinished run under that `flowId`.

`enqueue(steps)` appends to the pending queue. Throws on an id the run already has, or on a finished run.

`replacePending(steps)` swaps out everything not yet settled. Throws on an id that has already confirmed, or on a finished run.

`updateSnapshot(patch, { source })` folds in a patch. With `source: "user"` it throws while a run is running or paused; every other source always lands. The patch is an object to merge or a function to fold, and the function's argument is readonly because the live snapshot is frozen.

`pause()` stops at the next safe checkpoint. Does nothing if no run is going.

`resume()` restarts the loop. Throws if the run is already going or already finished.

`trash(flowId?)` discards the run and its storage. With no active run, pass a `flowId` to discard a stored run without restoring it first; with neither, it does nothing and announces nothing. Naming an id while a different run is restored throws.

`dispose()` lets go of this orchestrator without discarding anything: the loop stops, the scope hold is released, and the persisted run stays on disk for a later instance to restore. Use it when a component holding a shared `FlowScope` unmounts.

`restore({ flowId, steps })` hydrates a persisted run and returns the record, or `null`. Freezes the scope. Throws if the fresh plan lost an unfinished step, or if the record belongs to a different `adapterId`.

`preflight()` reconciles with the chain, runs `onResume`, and returns the diff. No wallet opens. Throws while the run is going, and rejects if the chain reads fail.

`reconcileInFlight()` is the chain half of preflight on its own. Also throws while the run is going.

`getRun()` and `getStatus()` read the current state. The run object is replaced rather than mutated, so comparing by identity is safe.

`listPersisted()` returns this adapter's incomplete runs.

`on(type | "*", handler)` and `subscribe(listener)` both return an unsubscribe. `subscribe` fires on any state change and is the `useSyncExternalStore` subscription.

Lifecycle calls a run cannot honour throw `FlowStateError`. It marks programmer error, not something to put in front of a user.

## Reading a run

A run is a union on `status`, so the fields that exist are the ones that mean something.

```ts
type Run =
  | { status: "running" }
  | { status: "paused"; reason: PauseReason; error?: FlowError }
  | { status: "failed"; error: FlowError }
  | { status: "completed" };
```

Plus the facts every run carries: `flowId`, `adapterId`, `snapshot`, `ctx`, `steps`, `startedAt`, and `persistedAt` on a restored one.

`paused` comes with one of six reasons. `requested` is your own `pause()`. `rejected` is a declined wallet prompt. `cancelled` is the wallet spending that nonce on something else. `adapter` is a hook returning `pause: true`. `interrupted` is a run restored after the tab went away mid-flight. `error` is a flaky RPC while waiting, or a build that threw.

Both `paused` and `failed` accept `resume()`. The split is `isFatalCause(error.cause)`, which is about how loudly the run stopped, not whether it can carry on. A revert deserves an explanation before the user tries again; a declined signature does not.

`idle` is not a run status. It is what `getStatus()` returns when there is no run at all.

Each step carries an outcome: `pending`, `awaiting-signature`, `submitted` with a hash, `confirmed` with a hash and block number, or `skipped`. There is deliberately no failed outcome; a step that failed goes back to `pending` and is retried on resume, and what went wrong belongs to the run. The exception is a wait that failed while the transaction may still mine, where the step keeps its `submitted` hash so resume adopts it.

## Events

`on(type, handler)` subscribes to one type, `on("*", handler)` to all. Both return an unsubscribe. Every event fires after its state has been persisted.

- `flow:started` on `start()`, with the total step count.
- `step:pending` when a step is about to build and prompt, with `index` and `total`.
- `step:submitted` once a hash exists and is on disk. Fired again for a hash adopted on resume.
- `step:replaced` when the wallet replaced the transaction, with `from`, `to` and the reason.
- `step:confirmed` with the full receipt. Also fired by `reconcileInFlight()` for a transaction that mined while the tab was away.
- `step:skipped` when `canSkip` returned true.
- `step:failed` on any error stop, always followed by exactly one of `flow:paused` or `flow:failed`.
- `snapshot:updated` on any snapshot change, carrying its source: `user`, `requote`, `receipt`, or `adapter` for an `afterStep` patch with no receipt behind it.
- `flow:paused` on every stop that leaves the run resumable.
- `flow:failed` when the stop was fatal, carrying the error. A revert found by `reconcileInFlight()` fires this too. The two are exclusive, so a listener can render "retry" on one and "start again" on the other without reading the status back.
- `flow:resuming` on `resume()`, before the loop restarts.
- `flow:completed` when the queue empties. Storage is already cleared and the scope already unfrozen.
- `flow:trashed` on `trash()`, carrying `abandoned` when a transaction was still out on chain. At most one step is ever in flight, so it is one hash or absent.
- `resume:review-ready` when `restore()` found a run.
- `resume:preflight` when `preflight()` finished, with the diff and any stale warning.
- `inform` when an adapter returned `inform`, or when the run could not be saved.

## Everything else exported

`createViemTxGateway({ client, sendTransaction, waitTimeoutMs })` binds a viem public client to whatever signs: a wagmi `sendTransaction`, a wallet client, a session key. `client` is `ReceiptClient`, a `Pick<PublicClient, ...>` over the three reads it makes, so a viem signature change fails here rather than in the app.

`createFlowRunStore({ storage, namespace, ttlMs, now })`, over `fromWebStorage(localStorage)` or `createMemoryStorage()`.

`createFlowScope()` gives `freeze(owner, reason)`, `unfreeze(owner)`, `isFrozen`, `reason`, `subscribe`. Held per owner, so several orchestrators can share one.

`classifyTxError(error)` returns `rejected`, `rpc` or `unknown`, walking the `cause` chain viem and wagmi wrap things in. Rejection is decided across the whole chain first, since a rejection often also reads as an internal RPC error once a provider has touched it. Unrecognised comes back as `unknown`, which stops the run rather than retrying blind. `cancelled` and `reverted` are read off the chain, not off a thrown value.

`isFatalCause(cause)` and `isRetryableRead(cause)` are policy, kept out of the cause so a wallet cancellation need not be filed as a user rejection to get the right handling. `describeTxError(error)` returns the one line worth showing a person.

`currentEntry`, `inFlightEntry`, `settledEntries`, `liveEntries`, `liveSteps`, `isLive`, `isSettled`, `summarise` read a run's step list.

`encodeState` and `decodeState` are the bigint-safe JSON the store uses.

## Testing

`src/__tests__/support` is the whole rig. No node required.

```ts
const h = harness({
  scripts: [{ sign: "accept", mine: "success" }, { sign: "reject" }],
});

await h.start([step("a"), step("b")]);

expect(h.types()).toContain("flow:paused");
expect(reasonOf(h.orchestrator.getRun())).toBe("rejected");
```

One `StepScript` per attempt, not per step, so a step retried after a rejection consumes the next entry. `sign` takes `"accept"`, `"reject"`, `"hold"` or `{ throws }`. `mine` takes `"success"`, `"revert"`, `"hold"` or `{ throws, attempts }`. `replacedBy` fakes the speed-up or cancel button.

`"hold"` parks the run mid-prompt or mid-wait, which drives pause, trash and tab-death. Release with `gateway.releaseSign()` and `gateway.releaseMine()`.

`gateway.setChainState(hash, { receipt, known })` fakes what reconciliation finds. The clock is manual: `advance(ms)` ages a run past its TTL, and `sleep` can be passed in to hold the retry backoff open.

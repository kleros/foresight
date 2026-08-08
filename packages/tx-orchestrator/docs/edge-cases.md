# Edge cases and limits

## The loop

For each unfinished step, in order:

1. Run `canSkip`. If true, record `skipped`, persist, emit, run `afterStep`, move on.
2. Emit `step:pending`. If the step already has a hash on disk from a previous life, adopt it and jump to 5.
3. Persist `awaiting-signature`, call `build`, then `gateway.sendTransaction`. The one wallet prompt.
4. Persist the hash, emit `step:submitted`. First checkpoint where stopping is safe.
5. Wait for the receipt, following wallet replacements, retrying reads that failed for RPC reasons.
6. Reverted fails the run. Cancelled or replaced pauses it. Confirmed records, persists, emits, runs `afterStep`.

A pause request is honoured at the top of the loop and again immediately after step 4. When the queue empties the run completes, storage is cleared, and the scope unfreezes.

## Wallet and chain

Each has a test in `src/__tests__/orchestrator.wallet.test.ts`.

**Signature declined.** Pauses with `reason: "rejected"`, no hash recorded. Resume rebuilds and prompts again.

**Sped up.** viem reports `repriced`. The run follows the replacement hash with no second signature, and persists the new hash the moment it appears, before it mines.

**Cancelled in the wallet.** A zero-value self-send took the nonce, so the step did not execute. Pauses with `reason: "cancelled"` and drops the dead hash, so resume signs a fresh transaction.

**Replaced by an unrelated transaction.** Treated as a cancel.

**Reverted.** The run fails. The hash is kept on `error.hash` for a review screen to link. Resume signs a new transaction rather than re-reading the failed one.

**Flaky RPC while waiting.** Retried with backoff, reads only, three attempts by default. When retries run out the run pauses and keeps the hash, since the transaction may still mine. A pause asked for during the backoff is honoured on the way out of it, not after another full wait.

**Tab closed mid-flight.** See [resuming.md](./resuming.md).

**Older than the TTL.** Auto-trashed on load, 72 hours by default.

## Pause, trash, dispose

`pause()` steps back from work that is still valid. Waiting on a receipt, it stops watching immediately, the hash being already persisted. With a prompt open the prompt is left alone, since aborting it could hide a signature that still lands, so the run stops at the next checkpoint. The scope stays frozen, because a paused run still owns the screen. Calling it on a run that is not running does nothing.

`trash()` discards the run. Storage cleared, run gone, scope released. A broadcast transaction is reported on `flow:trashed` as `abandoned`, because it is still out there.

`dispose()` releases this orchestrator without discarding: the loop stops and the scope hold goes, but the persisted run stays for a later instance.

## Nothing passed in can strand a run

A listener that throws is caught and logged, and so is one that rejects, which is a separate path: an `async` handler rejects after the surrounding try has returned. The emitter and the notifier isolate both.

A hook that throws stops the run cleanly, and the step that landed stays banked.

A storage backend that refuses to write or clear costs the safety net, not the flow.

A gateway that throws something unrecognised stops the run and asks, rather than retrying blind.

## Limits

**A prompt signed after `trash()` is unrecoverable.** No hash was recorded. Same for a tab closed with a prompt open, which reconciles as `unknown`. Recovering it needs a `canSkip` that asks the contract whether the work is already there.

**Aborting a receipt wait is a race, not a cancel.** viem's `waitForTransactionReceipt` takes no `AbortSignal`, so `createViemTxGateway` abandons the promise and lets the underlying poll expire against `waitTimeoutMs`, ten minutes by default. Nothing is signed meanwhile.

**The snapshot lock is shallow.** `run.snapshot.amount = x` throws and `updateSnapshot` refuses a user edit while a run is live, but `run.snapshot.items.push(x)` gets through. Treat the whole thing as readonly.

**Snapshot and context must be JSON-safe apart from `bigint`.** A `Date`, `Map` or client will not round-trip. Keep those in a closure.

**One run at a time per orchestrator.** Concurrent flows need separate instances, which can share one `FlowScope`.

**A hold on a shared scope outlives an instance you simply drop.** Completing, trashing or `dispose()` releases it. That is the deliberate direction to fail in, since the alternative unfreezes while someone else is still signing.

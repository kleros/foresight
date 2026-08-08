# Writing an adapter

An adapter is steps, hooks, and a gateway. The package supplies the loop.

## Steps

`build(ctx, snapshot)` runs immediately before every attempt and may be async. It reads the snapshot as it stands then, so a step planned at the start can encode an id, address or quote a previous step produced. If it throws, the run stops and no wallet opens.

`canSkip(ctx, snapshot)` is checked just before building. Use it for work the chain may already have: an allowance granted, a batch sent, a market created. A skipped step records `skipped`, fires `step:skipped`, and still runs `afterStep` with a `null` receipt.

Give `canSkip` to any step that is not safe to do twice. It is the only defence against the one case the package cannot see: a tab that died with the prompt open, where the user then approved it. No hash was recorded, so there is nothing to look up and resume will prompt again. A step without one reports `canSelfCheck: false` from `reconcileInFlight()`; warn before offering resume.

### Ids

An id means one step for the life of the run. Repeating one in a plan is refused, and so is planning an id that already confirmed on chain.

Ids must be stable across re-plans. `restore` asks for a fresh plan and matches persisted steps by id. Settled steps keep their result and need no builder, so only unfinished ones must match; a missing one throws.

A `skipped` id may be planned again and supersedes the old record. Nothing was spent on the skip.

### Changing the queue mid-run

`enqueue(steps)` appends. `replacePending(steps)` swaps out everything not yet settled. Neither touches finished steps, and neither drops a transaction in flight: a step with a wallet open or a hash on chain keeps its outcome while the new plan still contains its id.

## Hooks

Both are awaited by the loop rather than being events, because a re-quote must land before the next transaction is built.

### afterStep

Runs after every step that lands, confirmed or skipped, including one that reconciliation confirmed after a tab closed on it. Return nothing to carry on unchanged, or:

- `ctx` to replace the context.
- `snapshotPatch` to fold into the snapshot. An object merges; a function receives the snapshot readonly and must return a new one, because the live snapshot is frozen.
- `pending` to replace what is left.
- `inform` for a line of copy, emitted as an `inform` event.
- `pause: true` to stop before the next prompt, seen as `reason: "adapter"`.

This is where a receipt becomes something later steps need: read the deployed address from the logs, patch it in, and the next `build` sees it.

If `afterStep` throws, the run stops and the step that landed stays banked. The throw is classified like any other failure: a bad connection pauses, anything unrecognised fails.

### onResume

Runs once inside `preflight()`, before any wallet can open. Return:

- `pending` to re-plan what is left, having seen how old the run is.
- `ctx` to refresh addresses.
- `changes`, a list of `{ label, before, after, changePct? }` for the review screen.
- `staleWarning` for a line above it.

It also receives `inFlight` when reconciliation found a transaction still in the mempool. A returned `pending` that still contains that `stepId` means the broadcast transaction still does the job and the run adopts it. If it no longer does, leave the id out, or trash the run.

## Writing a gateway

Four methods, and nothing above them knows what a viem is:

```ts
interface TxGateway {
  sendTransaction(tx: FlowTx, opts?: { signal?: AbortSignal }): Promise<Hash>;
  waitForReceipt(args: {
    hash: Hash;
    confirmations?: number;
    signal?: AbortSignal;
    onReplaced?: (replacement: TxReplacement) => void;
  }): Promise<TransactionReceipt>;
  getReceipt(hash: Hash): Promise<TransactionReceipt | null>;
  isKnown(hash: Hash): Promise<boolean>;
}
```

The types are viem's; the behaviour is not. Any client can satisfy the port, and this has been run end to end on ethers v6 with a `JsonRpcProvider` and a `Wallet`.

Only three receipt fields are read: `transactionHash`, `blockNumber`, `status`. Map those and fill the rest.

Two conventions clients disagree about:

`getReceipt` returns `null` for an unmined transaction rather than throwing. viem throws, so `createViemTxGateway` catches its two not-found errors.

`getReceipt` returns a reverted receipt rather than throwing on one. ethers throws `CALL_EXCEPTION`, so an ethers gateway must catch that and return the receipt with `status: "reverted"`.

`isKnown` separates "still in the mempool" from "dropped after broadcast", which need opposite responses on resume. It is consulted only after `getReceipt` came back empty.

`onReplaced` fires the moment the wallet replaces a transaction, before the replacement mines, so the new hash reaches disk while the old one is still being waited on.

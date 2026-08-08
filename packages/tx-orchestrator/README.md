# @foresight/tx-orchestrator

Runs an ordered list of transactions, one signature at a time, and survives a closed tab.

Handles the failure modes multi-transaction flows share:

- Two wallet prompts open at once.
- A tab closed between approve and deposit, so the approve is paid for twice.
- A price that moves between step one and step two, so step two encodes a stale number.
- A speed-up in the wallet, so the app watches a hash that no longer exists.

Domain-agnostic. Steps come from the caller.

## Usage

```ts
const orchestrator = createTxOrchestrator<Snapshot, Ctx>({
  adapterId: "vault-deposit",
  gateway: createViemTxGateway({ client: publicClient, sendTransaction }),
  store: createFlowRunStore({ storage: fromWebStorage(localStorage) }),
  scope: flowScope,
  hooks: depositFlow,
});

await orchestrator.start({ flowId, snapshot, ctx, steps });
```

`adapterId` and `gateway` are required. Without `store` the run is memory-only and cannot be resumed. Without `scope` an internal one is used, unreachable from outside.

`start()` settling is not a success signal. It means the run reached `completed`, `paused` or `failed`. Read `getStatus()`.

## The pieces

`TxStep`: an id, a label, and `build`, called immediately before each attempt, so a step planned at the start can encode what an earlier step produced.

`snapshot`: what the flow is about and what it learns while running. Locked against outside edits while a run is live.

`ctx`: addresses and ids the steps need, which do not change on their own.

`TxGateway`: the only door to a chain. Four methods: send, wait for receipt, read receipt, is hash known.

`FlowRunStore`: where an incomplete run lives between visits, over a `FlowRunStorage` port.

`FlowScope`: a latch saying a flow owns the screen. Balance polls and refetches gate on it.

`FlowHooks`: `afterStep` and `onResume`.

## Example

Approve a token, then deposit it.

```ts
const steps: TxStep<DepositSnapshot, DepositCtx>[] = [
  {
    id: "approve",
    label: "Approve USDC",
    canSkip: async (ctx, snap) => (await allowance(ctx.token, ctx.account, ctx.vault)) >= snap.amount,
    build: (ctx, snap) => ({
      to: ctx.token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ctx.vault, snap.amount] }),
    }),
  },
  {
    id: "deposit",
    label: "Deposit",
    build: (ctx, snap) => ({
      to: ctx.vault,
      data: encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [snap.amount, ctx.account] }),
    }),
  },
];

const depositFlow: FlowHooks<DepositSnapshot, DepositCtx> = {
  afterStep: ({ completed, receipt }) => {
    if (completed.stepId !== "deposit" || !receipt) return;
    return { snapshotPatch: { shares: sharesFrom(receipt) } };
  },
};
```

Snapshot and context are persisted as JSON. `bigint` round-trips; `Date`, `Map` and clients do not.

## Guarantees

- One wallet prompt at a time.
- A confirmed step never runs again. Enforced by the types: only an unfinished step carries a builder.
- Every event fires after its state is persisted.
- A broadcast hash reaches disk before it is announced, survives a re-plan, and is reported on `flow:trashed`.
- A step id means one step. Repeats, and ids that already confirmed, are refused.
- Nothing passed in can strand a run: listeners that throw or reject, hooks that throw, storage that refuses to write.

## In React

```tsx
const run = useSyncExternalStore(orchestrator.subscribe, orchestrator.getRun);
const frozen = useSyncExternalStore(flowScope.subscribe, flowScope.isFrozen);
```

`getRun()` returns the same object until something changes. Derive progress from the step list:

```tsx
const done = settledEntries(run.steps).length;
const current = currentEntry(run.steps);
// "awaiting-signature" waits on a person, "submitted" waits on a block.
const phase = current?.outcome.status;
```

Anything that refetches on its own subscribes to the same `FlowScope` and holds still while `isFrozen()`.

## Docs

- [writing-an-adapter.md](docs/writing-an-adapter.md): steps, hooks, gateways for clients other than viem.
- [resuming.md](docs/resuming.md): persistence, the resume gate, what reconciliation can tell you.
- [edge-cases.md](docs/edge-cases.md): wallet and chain behaviour, pause versus trash, limits.
- [api.md](docs/api.md): full reference and events.

`src/__tests__/orchestrator.journey.test.ts` runs one flow end to end in seven acts.

## Layout

One thing per file. Only `orchestrator.ts` knows about more than one of them.

```text
src/
├── orchestrator.ts    Public lifecycle; assembles the parts below
├── driver.ts          The step loop: skip, sign, settle, record
├── runState.ts        The live run, and the only writer to storage
├── receiptWatcher.ts  Waiting for a receipt: retries, replacements, abort
├── reconcile.ts       What the chain says happened while the tab was away
├── emitter.ts         Events and change notifications
├── types.ts           The contract: steps, gateway, hooks, events
├── storage.ts         Persisted runs: namespaced, versioned, TTL'd, validated
├── codec.ts           JSON that survives bigint
├── scope.ts           FlowScope, the latch external refetches gate on
├── steps.ts           The step list: reading it, advancing it
├── errors.ts          What went wrong, and what that means for policy
├── viemGateway.ts     The one place that knows about viem
└── __tests__/         support/ has a scriptable fake wallet and chain
```

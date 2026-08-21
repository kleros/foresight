---
name: ui-logic-seam
description: Business logic and sensitive operations stay out of components in this repo — hooks are the seam, single transactions go through a useMutation hook, multi-signature flows go through the orchestrator. Use when writing or reviewing a component, adding a hook, wiring a write, or deciding where a piece of logic belongs.
---

# A component renders, and knows nothing else

A component may **call** business logic. It never **contains** it, and it never learns how it works — it knows the interface and nothing about the insides. The seam between the two is a **hook**.

Placement rules are in `bulletproof-web`; this is about what may cross into a component once it is placed. Interface vocabulary — seam, depth, deletion test — is in `codebase-design`.

## What a component may never contain

Grep for these in any file that returns JSX:

- An ABI, a contract address, a chain id **literal**, an RPC or endpoint URL, a query key
- `writeContract`, `sendTransaction`, `fetch`, `createPublicClient`, or any SDK construction
- Keys, secrets, nonces, signatures, SIWE messages
- Amount maths — decimals, `parseEther`, slippage, fees, rounding, bounds scaling
- The decision of *which* calls to make, or in what order
- `invalidateQueries`, retry, timeout, or error classification

What it may contain: markup, layout, local UI state (open, focused, which tab), display formatting through a shared formatter, and a hook call. Comparing a connected chain against a **named** constant to decide what to render is UI state, not business logic.

## Where each layer lives

| Layer | Path | Tested by |
| ----- | ---- | --------- |
| **Pure functions** | `features/<x>/utils/` — maths, encoding, planning, validation | Direct call, no mocks |
| **Services** | `lib/<thing>/` — one operation done to the world, reused across features | Direct call, fake client injected |
| **Hooks + requests** | `features/<x>/api/`, one file per request | Rarely worth testing |
| **Components** | `features/<x>/components/`, `app/<route>/_components/` | Rendering |

**A `lib/` module takes its viem client as an argument and imports no React.** Constructing a client inside it makes it untestable without intercepting the network and unusable against a second chain or a fork. This is also what lets the same module serve a hook, an e2e fixture, and a vitest suite.

## Single transaction: a `useMutation` hook

```ts
// The operation — plain async, explicit arguments, no React, no wagmi.
interface DepositArgs { account: Address; token: Address; amount: bigint }

async function deposit(client: Client, args: DepositArgs): Promise<Receipt> {
  // encode, submit, wait, throw on failure
}

// The seam — thin, and the only place that knows what the write invalidates.
export function useDeposit(onSuccess?: () => void) {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: DepositArgs) => deposit(client, args),
    onSuccess: () => {
      onSuccess?.();
      queryClient.invalidateQueries({ queryKey: balanceKey });
    },
  });
}

// The component — the whole of its knowledge.
const { mutate, isPending, error } = useDeposit();
```

Four rules make the shape hold:

- **The operation throws.** Never return an `{ ok, error }` union for the hook to unpack — the mutation's error state is what that is for, and a hand-rolled result type is how a failure ends up rendering nothing.
- **The hook stays thin.** Branching or arithmetic inside a hook belongs in the function beneath it.
- **Invalidation lives in the hook.** A component calling `invalidateQueries` after `mutate` has learned what the write touched.
- **One operation per hook.** Two writes that must both land are a flow, not a mutation.

## More than one signature is not more than one mutation

Chained mutations have no memory: a reload halfway through loses every step before it, and nothing knows how to resume. Multi-signature sequences go through `packages/tx-orchestrator` with a flow adapter in `features/<x>/flow/` — see `features/session-create/flow/` for the shape.

The orchestrator rebuilds every step from scratch on each attempt, including after a reload, so a step's `build()` must be pure: no hooks, no live clients. `no-restricted-imports` in `apps/web/eslint.config.mjs` enforces that over flow code, and resume breaks in ways tests do not catch when it is violated.

## The test that settles it

**Can the logic be asserted without rendering?** If it needs a render, it is in the wrong place. And if a component's test needs a viem client or an indexer response mocked, that component is reaching past its seam.

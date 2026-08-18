# `features/session-create/flow`

The domain half of session deploy: a flow adapter over `@foresight/tx-orchestrator`, running the deploy in phases so the wallet is asked one batch at a time.

It turns resolved wizard input into a metadata document, into the structs `SessionFactory` takes, and into the step plan the orchestrator signs. An uploader is passed in, the factory ABI comes from `@/config/contracts`, and transactions are handed back to be sent.

## The rule

**It stays framework-free.** No React, Next, wagmi or live clients, enforced by a `no-restricted-imports` zone over `src/features/*/flow/**` in `eslint.config.mjs`. This is load-bearing rather than tidiness: the orchestrator rebuilds every step from scratch on each attempt, including after a reload, so anything reaching for a hook or a connected client breaks resume in a way tests do not catch. Take what you need as an argument.

| File          | Holds                                                      |
| ------------- | ---------------------------------------------------------- |
| `plan.ts`     | `planSessionDeploy` and the `afterStep` hook               |
| `params.ts`   | Wizard input to factory structs, and the batching rules    |
| `metadata.ts` | The display metadata document                              |
| `publish.ts`  | Upload plus read-back verify, through an injected uploader |
| `receipts.ts` | Reading deployed addresses back out of a receipt's logs    |
| `types.ts`    | The snapshot, the context and the input shapes             |

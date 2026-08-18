---
name: writing-tests
description: How tests get written in this repo. Use when adding, changing, reviewing, naming or consolidating any test, fixture, fake or harness, when deciding what an assertion should compare against, or when judging whether a passing test is worth anything. Covers where the expected value may come from, mock drift, choosing a test double, testing behaviour over implementation, mutation testing, and determinism.
---

# Writing tests

The default failure of a bad test is not that it fails. It is that it passes.

A test built on a shape you invented keeps passing after the real shape has moved, and reports green while production breaks. Everything below is aimed at that.

## Start here: can the real thing build it?

Before you hand-write an object that stands in for something a library owns, ask in order. First yes wins.

1. **Can I use the real implementation?** Then use it. A pure function, a value object, an in-memory store you wrote. Prefer real over any double.
2. **Can the library construct the thing for me?** Then construct it. `new UserRejectedRequestError(...)` from viem, `makeError(..., "ACTION_REJECTED", ...)` from ethers. Never retype what a constructor will build.
3. **Can I type it without a cast?** Then fill in every field rather than casting a partial. The cast is what turns a rename into a silent pass.
4. **Only then** hand-write the shape, and say in a comment why no library could produce it.

Step 4 is legitimate for things no library owns: a raw EIP-1193 provider object, a wallet's own error wording, malformed input, junk. It is not legitimate for anything you can name after a library.

## Mock drift

Mock drift is when your double and the real thing disagree, and nothing tells you. Your suite is now testing your memory of a dependency instead of the dependency.

It is not theoretical. Working on `packages/tx-orchestrator`, a hand-written receipt fake asserted `transactionHash`. ethers v6 calls that field `hash`, and `transactionIndex` is `index`, and `status` is `0 | 1` rather than `"success" | "reverted"`. Every one of those renames is invisible to a cast, and the last one silently records a reverted transaction as a confirmed one.

How to spot it in a diff:

- `as unknown as SomeLibraryType`, or any cast that widens a partial object into a library's type.
- `Object.assign(new Error(...), { name: "SomeLibraryError" })`. The name is a string you typed.
- A test whose title names a library, whose body constructs the shape by hand.
- A fixture file of JSON captured from an API once, with no check that the API still returns it.

How to fix it, cheapest first:

- Build the real object. Add the library as a devDependency if that is what it takes; a devDependency costs nothing at runtime.
- If the type is a class you cannot construct without a live connection, cast the _fake input_ but make sure the _code under test reads it through the real type_. A rename then fails to compile in your mapper before the fake matters. Say so in a comment.
- If you must keep a hand-written double, pin it: assert against a real instance somewhere, even once. One real assertion protects every synthetic one that shares the shape.

Split test files by who can build the error or object, and name the blocks that way. `classifyTxError, against viem` and `classifyTxError, against shapes no library will build for us` are honest headings; one undifferentiated block that mixes both is not. See `packages/tx-orchestrator/src/__tests__/errors.test.ts`.

## Don't mock what you don't own

When a third-party API is awkward to fake, that is a design signal, not a mocking problem. Wrap it in a port you own, then fake the port.

`TxGateway` in `packages/tx-orchestrator` is the worked example: four methods, the only door to a chain, so the whole wallet edge-case suite runs with no node and no network. The wrapper also documents exactly how much of the dependency you actually use, which is what makes swapping it later possible.

Two consequences worth knowing. Mocking a type you do not own hardcodes your assumptions about a library into your tests, so upgrading that library becomes a manual sweep through test files. And a mock of someone else's API can be wrong the day you write it, because nothing checks it against the real thing.

## Verified fakes

If a fake is shared across many tests, it is load-bearing, and it deserves its own proof. The rule from Google is that whoever owns the real implementation owns the fake, and contract tests verify both behave the same.

In practice here: a shared fake lives in `__tests__/support/`, it is fully typed with no casts, and at least one test exercises the real dependency to pin the fake's assumptions. `fakeGateway.ts` throws viem's real `UserRejectedRequestError` rather than an error wearing its name, so every `sign: "reject"` script in the suite rides on the real shape.

## Test behaviour, not implementation

Test through the public API. If a test knows about a private helper, a call order, or an internal field, it will break on a refactor that changed nothing a user can see, and that is the main reason suites get abandoned.

- Name the test after the behaviour, not the method. `refuses a run belonging to another adapter` beats `restore() throws`.
- State the behaviour and stop. `refuses bounds that are not strictly increasing`, not `...which the contract does not check`. The consequence belongs in the code or in a one-line comment, not in the title.
- Names must stand alone. `still asks once when told to try fewer times than that` broke the moment the test above it was renamed, because "that" pointed at the other title.
- Two names that read the same in the output are ambiguous even in different `describe` blocks. `refuses a zero bond on a branch` and `refuses a zero bond on the decision`.
- Assert on state, not on interactions, unless the interaction _is_ the behaviour. `expect(signRequests).toHaveLength(1)` is a state assertion about the wallet being prompted once, which is the actual guarantee. `expect(spy).toHaveBeenCalled()` on an internal collaborator usually is not.
- Prefer stubs to mocks. If you are unsure which you need, you want a stub. Reach for a mock only when the protocol between two objects is the thing under test.
- One behaviour per test. If the name needs "and", split it.

## Delete tests that outlived their code

When a behaviour goes, its test goes with it. Two shapes to watch for, both of which stay green and both of which mislead.

**A test asserting an absence.** After removing a query from a step, `expect(asked).toHaveLength(0)` pins the removal rather than any behaviour. It couples the suite to an implementation detail and earns nothing.

**A test whose name no longer says why it passes.** `patches nothing without a receipt` was written when the code returned early on a null receipt. Once a null receipt started routing to a lookup, it passed only because no lookup was supplied, which another test already covered. The name described a mechanism that had moved.

After changing a guard, reread the tests around it and ask of each: what would have to break for this to fail? If the answer is no longer the thing in the title, rewrite it or delete it.

## Never write a number the source already owns

A test that hardcodes a value derived from a constant reddens when someone retunes the constant, and the failure looks like a bug in the code rather than in the test.

Export the constant and derive:

```ts
// No
expect(call.args[1]).toHaveLength(6);
expect(() => publish({ attempts: 5 })).rejects.toThrow(/after 5 attempts/);

// Yes
expect(call.args[1]).toHaveLength(CHILD_BATCH_SIZE);
expect(() => publish(...)).rejects.toThrow(new RegExp(`after ${READ_BACK_ATTEMPTS} attempts`));
```

Fixture sizes count in units of the constant: `CHILD_BATCH_SIZE * 2 + 2` is "three batches, the last one part full" at any batch size. Name it that way.

**Prove it by retuning.** Change the constant, run, change it back. In this repo `CHILD_BATCH_SIZE` was verified at 3, 4, 6, 8, 12 and 24; four tests across three files were only found that way, including one written an hour earlier.

**A requirement is not a derived value.** `MIN_READ_BACK_WINDOW_MS` is 12 seconds because that is the guarantee, independent of how many attempts fit in it. Lowering the attempt count should redden that test. Do not "fix" it by deriving the floor from the attempts.

## Where the expected value comes from

The section above says derive from the source. This one is its other half: **derive from the input, never from the code under test, and keep the input where the reader can see it.** A test is only worth what its expected value is independent of.

Deriving from the **input** is the property under test. In the e2e specs the draft typed into the wizard is the input, so `expect(chain.upperBound).toBe(parseEther(draft.upper))` asserts input against output, and re-typing `500.25` would just rot when the fixture is retuned.

Deriving through the **code's own helpers** asserts that the code agrees with itself. Where the wizard _derives_ rather than carries, a token slugged from a label, the expected value is written out: computing it with `slugToken` would prove nothing.

Three shapes this goes wrong, all found in one session on `features/session-create`:

**The consistency test.** Comparing the encoder's output against a helper that shares its implementation:

```ts
// Both call branchBoundSources then scaleToWei. f(x) === f(x).
expect(deployed.children[i].lowerBound).toBe(branchBoundsWei(draft, outcome).lower);
```

It can only catch someone unwiring the shared call. It cannot see the shared rule itself move, proven when a mutation removing a `.trim()` survived it. Pin coupling this way if you like, but never describe it as a correctness test.

**Consolidation that moves the inputs.** Merging four hand-rolled fixture builders into one `support/` module is right. It also silently relocated `name`, `template`, `unit` and the decision date out of the suite, leaving it asserting `NOON_20_SEPT_2099` against a date defined in another file: the oracle intact, unreadable, and breakable from a distance. **A suite spells out every field its assertions turn on, defaults included, even when the shared builder would supply the same value.** The builder covers the inert remainder.

**Constants named after their digits.** `FIVE_HUNDRED_AND_A_QUARTER` says what the number is, not that it came from `upper: "500.25"`. Key them by their source so the assertion line carries the link:

```ts
const WEI = { "10": 10_000000000000000000n, "500.25": 500_250000000000000000n } as const;
expect(child.lowerBound).toBe(WEI["10"]); // draft has lower: "10"
```

**The check is mechanical, and it is the mutation sweep pointed the other way.** Change the shared fixture's values and confirm the suites that assert them still pass; change the rule under test and confirm they go red. A suite that moves when scenery moves is coupled to the wrong thing.

## Mutation testing is the only proof

A green suite proves nothing about the guards it never exercised. Break each guard one at a time and confirm exactly the test that names it goes red.

```bash
cp guard.ts /tmp/bak
perl -0pi -e 's/if \(someCondition\)/if (false)/' guard.ts
yarn vitest run path/to/tests
cp /tmp/bak guard.ts
```

Sweep the whole module, not just the line you changed. A sweep of 26 guards in `features/session-create/flow` found one survivor, and the survivor was not a missing test: it was a value nothing consumed, emitted into the void. **A mutation that survives is either an untested guard or dead code. Find out which before writing the test.**

Sweep again after adding tests, to confirm the new ones bite.

## Reproduce before you report

When you suspect a defect, write a throwaway that runs the real code and prints what actually happens, then delete it. A probe against the real driver turned "an indexer lag might be classified wrong" into:

```
stage: halted | failure: {"message":"The indexer is 20 blocks behind","recoverable":false} | sent: 1
```

which is a different and much worse claim than the one being guessed at. Two suspicions died this way in `packages/tx-orchestrator`; do not skip it because the reasoning feels airtight.

**Layout is not reasoned about, it is measured.** Reading a stylesheet tells you what a rule says, not what a box does. Drive the running app and read `getBoundingClientRect()`: a grid "clearly wide enough" was a **398px column inside a 1280px window**, and a banner that "should wrap" held 450px of text in a 398px card. Both diagnoses were wrong until measured, and the numbers named the fix.

Prefer one instrumented reproduction to three plausible explanations. A flake is especially good at attracting them: blaming connector accumulation and a stray react-query error both survived argument and died to a single measurement.

## Readable over clever

Tests are DAMP, not DRY: descriptive and meaningful phrases beat deduplication. Some repetition in tests is a feature, because a test should be obviously correct while read top to bottom, with no jumping to a helper to learn what it asserts.

Extract a helper when it removes noise (a harness, a builder, a scripted gateway). Do not extract when it hides the thing being tested. A reader should never have to open another file to know what the assertion means.

Every test reads arrange, act, assert, in that order, with the act as a single line where possible.

## Determinism

A flaky test is worse than no test, because it teaches people to rerun rather than to look.

- No wall clock. Inject `now`. `createTxOrchestrator` takes `now` and `sleep` for exactly this, and the harness clock moves only when a test calls `advance(ms)`.
- No randomness, no `Date.now()`, no `Math.random()` in a fixture. Derive ids from an index.
- No network, no real chain, no sleeping. If a test needs to be somewhere mid-flight, make the fake hold there deliberately, the way `sign: "hold"` and `mine: "hold"` do.
- No shared mutable state between test files, and no dependence on file order.

Sequential tests that share one story are an exception worth naming explicitly when you use it. `orchestrator.journey.test.ts` does this because each act is a checkpoint in a single run, and it says so in a header comment.

Two flake sources worth naming, because both look like the code under test misbehaving:

**A helper that assumes its effect took.** `connectMockAccount` awaits wagmi's `connect`, which resolves `status: "connected"` with the right account — while the provider's own reconnect-from-storage can land a moment later and overwrite it. The store reads connected, the DOM reads "No wallet connected", and every failure points at whatever the test did next. **A setup helper whose effect something else can undo must confirm and retry, not assume**: loop until the state is still reported, and throw if it never holds.

**A wait that does not prove what it waits for.** Reloading after `expect(page.getByText("Awaiting your signature")).toBeVisible()` proved nothing: that row renders from page load, so the test could reload before anything was stored. Pick a signal that can only appear _after_ the thing you need — a market row reading "confirming" only happens once the run is persisted and the wallet asked. **Ask of every wait: could this be true before the step I care about ran?**

## Faking a service you route around

An e2e fault injector that _replaces_ a response encodes today's request shape. When requests are merged, batched or aliased, it answers the wrong document and the failure surfaces somewhere unrecognisable.

Concurrent subgraph calls are merged by `@graphql-tools/batch-execute` into one document under `_v0_`/`_v1_` aliases. An injector that fulfils a fixed `{ data: { Session: [], chain_metadata: [...] } }` then throws `Key Session is not correctly prefixed`, which reaches the screen as a **non-retryable deploy failure** — nowhere near the truth. The quieter half of the same bug: `body.data.chain_metadata` is `undefined` under an alias, so an injector reaching for it injects nothing and its test passes for the wrong reason.

**Fetch the real response and edit it**, matching entries by the name they end with rather than equal — one shared `entriesNamed(data, field)` serves every injector on that route. The rule generalises past GraphQL: prefer editing what came back to inventing what should have.

## Coverage is a symptom

Chase behaviours, not percentages. A line-covered branch with no assertion about what it produced proves the line runs, nothing more. Ask instead: which failures would this catch, and is any of them the expensive one?

Cover the expensive failure first. In this repo the expensive ones are money-shaped: a step signed twice, a revert recorded as a success, a run that resumes work already on chain.

## Before you commit a test

- Would this fail if I broke the behaviour it names? Try it. Break the code and watch it go red.
- Does anything in it hardcode a number the source owns? Retune the constant and see.
- Is it asserting an absence, or a behaviour that has since moved?
- **Where does the expected value come from?** The input, or a literal. If it came from the code under test, the test asserts nothing.
- **Can I point at the input that produces each expected value, on the same screen?** If a fixture supplies it from another file, spell it out here.
- Would this still pass if the library changed its shape underneath me?
- Does it read top to bottom without opening another file?
- Does it name a behaviour, or a method?
- Is there a cast in it, and can I delete the cast?
- Is anything in it non-deterministic?

## Sources

- [Mocks Aren't Stubs, Martin Fowler](https://martinfowler.com/articles/mocksArentStubs.html)
- [Testing on the Toilet: Don't Mock Types You Don't Own](https://testing.googleblog.com/2020/07/testing-on-toilet-dont-mock-types-you.html)
- [Don't mock what you don't own, testdouble wiki](https://github.com/testdouble/contributing-tests/wiki/Don't-mock-what-you-don't-own)
- [Software Engineering at Google, ch. 13: Test Doubles](https://abseil.io/resources/swe-book/html/ch13.html)
- [Software Engineering at Google, ch. 12: Unit Testing](https://abseil.io/resources/swe-book/html/ch12.html)
- [Testing on the Toilet: Tests Too DRY? Make Them DAMP!](https://testing.googleblog.com/2019/12/testing-on-toilet-tests-too-dry-make.html)
- [Consumer-Driven Contract Testing, Microsoft Engineering Playbook](https://microsoft.github.io/code-with-engineering-playbook/automated-testing/cdc-testing/)
- [Writing Consumer tests, Pact](https://docs.pact.io/consumer)

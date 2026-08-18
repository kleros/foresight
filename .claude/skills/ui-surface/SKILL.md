---
name: ui-surface
description: What a user reads and what they see — error copy, service names, states worth rendering, and layout that has to survive a hash or a narrow column. Use when writing or reviewing any user-facing string, error message, status row, or CSS that sizes something.
---

# The user-facing surface

`bulletproof-web` says where a file goes. This says what it may show once it is there.

Two questions carry most of it: **would a stranger understand this without knowing our stack**, and **does this survive the widest thing it can be asked to hold**.

## Never name our own services

A creator chose to deploy a session. They did not choose Atlas, envio, a subgraph or a gateway, and naming those in an error asks them to debug our architecture.

| Instead of                                      | Say                                                   |
| ----------------------------------------------- | ----------------------------------------------------- |
| `Atlas would not accept hero.png`               | `hero.png could not be uploaded`                      |
| `The indexer is 4 blocks behind the chain`      | `Still catching up with the chain, 4 blocks behind`   |
| `The subgraph has not caught up with session 7` | `The session has not appeared`                        |
| `Subgraph query failed.`                        | `Could not load session data. Try again in a moment.` |
| `https://…/QmX answered 502`                    | `The upload could not be read back (502)`             |

Third-party protocols the user is genuinely transacting with are different. **Seer** stays: those are Seer markets, a choice the deployer made. The test is whether the name is a thing they picked or plumbing we picked for them.

Internal class names are fine — `IndexerNotReadyError` is never rendered. Build-time env validation is fine; a developer reads it.

### An SDK will leak its own words unless you stop it

The rule is not satisfied by sweeping your own strings. `@kleros/kleros-app` does this on a failed upload:

```js
const s = await r.json().catch(() => ({ message: "Error uploading to IPFS" }));
throw r.status === 401 ? new Pe(s.message) : new Error(s.message);
```

The **server's** `message` is rethrown verbatim, so anything that renders `error.message` puts it on screen. A service answering `{"message": "Atlas is out."}` writes that into the deploy banner.

**Catch third-party failures at the boundary module and substitute your own wording**, keeping causes apart where the user's next action differs — an expired session wants "Sign in again", a 503 wants "Try again in a moment". Pin it with a test that asserts the service's name is _absent_, since the leak returns whenever the dependency is upgraded. See `src/lib/atlas/ipfs.ts` and its tests.

## Only render a state you can actually observe

A row that lies is worse than a row that is missing.

A separate `"Awaiting your signature"` timeline step cannot work here. It can read _active_ only in the instant between the upload finishing and the run starting; once the wallet opens, the step is `running` and the row flips to **done** — telling the user their signature was given while the wallet is still waiting for it.

Before adding a status row, ask **which observable value makes this true, and for how long**. If the honest answer is "a value that has already moved on", the row is decoration. Put the ask where the wait is instead — a `Confirm in your wallet` detail on the row being signed, in every mode, because that is a state the app can see.

Corollary: when such a row goes, delete the test that pinned it rather than adapting it. A test named `counts the signature as given once the transaction is out there` is asserting the bug.

## Say it once

The UI already carries most of what prose repeats. If chips mark branches `(missing)`, a caption explaining that unfilled means missing is noise. Lists headed _Already on-chain_ and _Still missing_ carry the count, and a sentence restating it can contradict them: "6 of 6 branch markets were created. Nobody can trade it until the rest exist."

Cut mechanism, not meaning. A warning that continuing **pays twice** survives every trim, because it is money rather than explanation.

Avoid internal vocabulary in copy even when it is not a service name: users have a _deploy_, not a _run_.

## Layout sizes against its container, not the window

A media query on viewport width is a guess about how much room the content has, and in a page with rails it is usually wrong.

The wizard's content column measures **398px inside a 1280px window** — the rail and preview take the rest. A `@media (max-width: 1040px)` breakpoint therefore holds a two-column grid inside a 398px column, and a `180px 180px 1fr` row leaves its third child nothing.

Prefer intrinsic sizing, which cannot be wrong about a width it is measuring:

```css
/* Wraps when the column runs out, whatever the window is doing. */
.fs-two {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

/* Two inputs and a wide track: the track takes a row of its own rather than a sliver. */
.fs-three {
  display: flex;
  flex-wrap: wrap;
}
.fs-three > * {
  flex: 1 1 180px;
  min-width: 0;
}
.fs-three > :last-child {
  flex: 1 1 260px;
}
```

Reach for a viewport query only for genuinely viewport-shaped decisions — the rails collapsing — and say so in a comment.

## Text that can hold a hash

Addresses, CIDs and transaction hashes are single unbreakable tokens. Any element that can receive one needs **both**:

- `min-w-0` on the flex child that holds it — `flex-1` alone will not shrink below its content, so the token pushes the row wider than its card;
- `break-words` on the text — `text-pretty` and `truncate` do not break inside a word.

Measured: a CID in a failure banner renders 450px wide inside a 398px card. With both, 326px and contained.

Where the value is decorative rather than read aloud — a hash beside a title — `truncate` on a `min-w-0` sibling is fine. Where it is the message, wrap it.

## Reviewing this surface

- Read every new string as someone who has never seen the repo. Any proper noun that is ours is a bug.
- Follow error text back to its source: does a dependency's message reach the screen unfiltered?
- For each status row, name the value that makes it true.
- For each new grid or flex row, ask what happens at the narrowest column it can appear in — and measure it rather than reasoning (see `writing-tests`).

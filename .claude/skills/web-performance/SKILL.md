---
name: web-performance
description: Performance rules for frontend work in this repo — bundle discipline, loading strategy, and query hygiene. Use when adding or reviewing pages, widgets, data hooks, or any heavy dependency.
---

# Web performance

Every change should leave the app as fast as it was, or explain why it can't. Users feel bundle size and layout shift long before they feel anything else.

## Heavy dependencies

Charting libraries, wallet connectors, editors, animation engines — anything large — must not land in the initial bundle just because one screen needs it.

1. **Load it dynamically.** Import on the route or interaction that needs it, not at the app root.
2. **Gate it on intent.** Mount modals and panels when opened, not on page load. Prefetch on hover or focus when a click is likely — the interaction feels instant without everyone paying for it.
3. **If neither is possible, say so.** Tell the developer what the addition costs and what it affects, rather than adding it silently. A warning they can act on beats a regression they discover in production.

## Loading strategy

Split data into what the page needs to render and what can arrive after.

- Render structure and content first; stream live or per-user data in behind skeletons.
- Skeletons should match the final layout's dimensions — a correct loading state that shifts on arrival is still a bad one.
- Don't block first paint on data that only some users will look at.

## Queries

- Gate user-specific fetches on having a user — never fetch balances or personalized data without an identity.
- Set staleness by how fast the data actually changes: static config can be cached indefinitely, live values need short windows.
- Batch reads that go to the same source in one tick instead of firing them serially.
- One source per field. If a value comes from an index, don't also refetch it from the origin.

## Assets

- Images through the framework's image component with explicit dimensions or `fill` + `sizes`.
- Fonts through the framework's font loader, not ad-hoc `@font-face`.

## Before merging frontend work

1. Is anything new heavy, and is it dynamically loaded?
2. Do loading states match final dimensions?
3. Are user-specific queries gated on a user?
4. Do dynamic pages set their metadata for sharing and search?
5. Did you check the build output for the routes you touched?

If a change makes something measurably slower and there's no way around it, flag the tradeoff explicitly rather than letting it pass unmentioned.

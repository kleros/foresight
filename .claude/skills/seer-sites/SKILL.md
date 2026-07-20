---
name: seer-sites
description: Reference for Seer multi-page site patterns with @seer-pm/sdk and @seer-pm/react. Use when building Foresight web flows that mirror Seer market list, detail, trade, create.
---

# Seer Sites (reference for Foresight)

Full skill: https://github.com/seer-pm/demo/blob/main/skills/seer-sites/SKILL.md

Foresight adapts Seer patterns but adds:

- `/create` Session wizard (Foresight Session factory — not `useCreateMarket` alone)
- `/session/[parentId]` composed futarchy page (predict batch via Trade executor)
- Curate registry homepage
- Creator dashboard + Credit managers

Reuse from Seer sites skill:

- Markets list / detail data loading (`useMarkets`, `useMarket`)
- Trade widget patterns (`useQuoteTrade`, approval flow)
- `SwapWidget` / `OutcomesList` examples under `seer-pm/demo/skills/seer-sites/examples/`
- No mock data rule — always real hooks

UI: Foresight uses **@kleros/ui-components-library**, not Stitch defaults.

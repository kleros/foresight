---
name: seer-integration
description: Integrate with the Seer prediction market protocol via @seer-pm/sdk and @seer-pm/react. Use for markets, pools, quotes, split/merge/redeem, and Seer HTTP API.
---

# Seer integration (Foresight)

Foresight builds on Seer. Use integration docs as source of truth: https://github.com/seer-pm/demo/tree/main/integration-docs

## Foresight vs Seer

| Layer                                                    | Owner                            |
| -------------------------------------------------------- | -------------------------------- |
| Session factory, Trade executor, Credit managers, Curate | Foresight `packages/` + ADRs     |
| Market data, pools, odds, quotes, split/merge/redeem     | `@seer-pm/sdk`, `@seer-pm/react` |

See `.cursor/docs/adr/0014-seer-packages.md`.

## Key docs

| Goal                | Document                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| Overview            | [0-intro.md](https://github.com/seer-pm/demo/raw/main/integration-docs/0-intro.md)                             |
| Conditional markets | [5-conditional-market.md](https://github.com/seer-pm/demo/raw/main/integration-docs/5-conditional-market.md)   |
| Trading             | [7-trading.md](https://github.com/seer-pm/demo/raw/main/integration-docs/7-trading.md)                         |
| HTTP API            | [8-api.md](https://github.com/seer-pm/demo/raw/main/integration-docs/8-api.md)                                 |
| Collateral profiles | [9-collateral-profiles.md](https://github.com/seer-pm/demo/raw/main/integration-docs/9-collateral-profiles.md) |

## React hooks (prefer over raw calls)

- Liquidity: `useMarketPools`, `useMarketHasLiquidity`
- Odds: `useMarketOdds`
- Quotes/trade: `useQuoteTrade`, `useTrade`
- Markets: `useMarket`, `useMarkets`

Do not invent `SeerProvider` — use wagmi + TanStack Query.

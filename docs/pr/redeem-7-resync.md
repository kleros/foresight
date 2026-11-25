# Redeem 7: indexer schema change and production resync

Issue `2026-11-24-foresight-redeem-7-indexer-pnl`. This branch changes the indexer's schema and the events it follows, so the production indexer must sync again from its start block. Existing rows were written under the old rules and are not migrated.

## Schema change (`apps/indexer/schema.graphql`, against `master`)

New entities:

| Entity | Holds |
| --- | --- |
| `Redeem` | One account's redeem of one market's tokens in one transaction: account, session, child market (null for parent tokens), parent outcome index, sDAI payout. |
| `ParentOutcomeToken` | Each session's parent outcome tokens, INVALID included. |
| `MarketCondition` | Each Seer market's ConditionalTokens condition and its payout numerators. |
| `ResolvedCondition` | Every ConditionalTokens resolution, keyed by condition id. |
| `SessionMove` | A trade wallet's move of a session token, credited per session, with the sDAI cost it adds. |
| `RedeemPull` | A session token sent to one of Seer's routers, waiting for the router's answer in the same transaction. |
| `SplitMint` | A parent INVALID mint that is not cost until its transaction shows it pays for a prediction. |

Changed fields: `Session.invalidToken` and `ChildMarket.invalidToken` gain `@index`.

## Config change (`config.template.yaml` and the three generated configs)

- New contract `ConditionalTokens` (0xCeAfDD6bc0bEF976fdCd1112955828E00543c0Ce) with `ConditionResolution` and `PayoutRedemption`; the handler keeps only `PayoutRedemption` events whose redeemer is one of Seer's two routers.
- In code, a second wildcard `TradeExecutor.Transfer` registration (`src/handlers/SeerRouterTransfer.ts`) follows every ERC-20 transfer into or out of Seer's routers.

## What Harman runs

The production indexer is on Envio Cloud (`apps/indexer/README.md`, "Deploying to Envio Cloud": root `apps/indexer`, config `config.gnosis.yaml`). After this branch merges:

1. Deploy the merged commit on Envio Cloud as a new deployment of the indexer, with the same root directory, config file and `.env.gnosis` values as now.
2. Let it sync from `start_block` 47790580 (in `config.gnosis.yaml`) to the chain head. Do not reuse the old deployment's database: rows from before this branch have no `SessionMove`, `Redeem` or `ResolvedCondition` history to build on.
3. When the new deployment reports it is synced, point the web's `NEXT_PUBLIC_SUBGRAPH_URL` at its GraphQL endpoint and retire the old deployment.

The repo documents no CLI command for an Envio Cloud resync; the steps above are the dashboard flow the README describes. To check the same sync locally first:

```bash
cd apps/indexer
yarn dev:gnosis        # envio dev --config config.gnosis.yaml, from start_block
yarn codegen:local     # afterwards, so check-types sees the 31337 types again
```

## Known limits after the resync

- A condition that resolved before `start_block` is not in `ResolvedCondition`; a market on it gets no numerators, and its redeems split by token count.
- A trade wallet's liquidity seed paid in sDAI still counts as prediction cost; only the xDAI seed (`splitFromBase`) is left out.
- A merge of sets that were never cost still lowers the session's cost.

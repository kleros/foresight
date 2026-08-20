import { indexer } from "envio";

import { ipfsPath } from "../utils";
import { fetchChildMarket } from "../utils/contracts/fetchChildMarket";
import { fetchOpeningTime } from "../utils/contracts/fetchOpeningTime";
import { fetchParentMarket } from "../utils/contracts/fetchParentMarket";
import { fetchSessionMetadata } from "../utils/ipfs/fetchSessionMetadata";

const keywordOf = (parts: (string | null | undefined)[]): string => parts.filter(Boolean).join(" ");

const SESSION_COUNTER_ID = "global";

indexer.onEvent({ contract: "SessionFactory", event: "ParentMarketDeployed" }, async ({ event, context }) => {
  const outcomeCount = Number(event.params.outcomeCount);

  const [market, metadata, openingTime] = await Promise.all([
    context.effect(fetchParentMarket, { chainId: event.chainId, address: event.params.parentMarket, outcomeCount }),
    context.effect(fetchSessionMetadata, { path: ipfsPath(event.params.metadataUri) }),
    context.effect(fetchOpeningTime, { chainId: event.chainId, address: event.params.parentMarket }),
  ]);

  context.Session.set({
    id: event.params.sessionId.toString(),
    sessionId: event.params.sessionId,
    deployer: event.params.deployer,
    parentMarket: event.params.parentMarket,
    outcomeCount: event.params.outcomeCount,
    deployedChildCount: 0n,
    openedAt: BigInt(event.block.timestamp),
    completedAt: 0n,
    marketName: market.marketName,
    outcomes: market.outcomes,
    openingTime: openingTime === null ? undefined : BigInt(openingTime),
    metadataUri: event.params.metadataUri,
    metadataResolved: metadata !== null,
    title: metadata?.session.title,
    description: metadata?.session.description,
    heroImage: metadata?.session.heroImage,
    icon: metadata?.session.icon,
    itemName: metadata?.session.itemName,
    itemNamePlural: metadata?.session.itemNamePlural,
    blocks: metadata?.session.blocks ?? [],
    keyword: keywordOf([
      market.marketName,
      ...market.outcomes,
      metadata?.session.title,
      metadata?.session.description,
      ...(metadata?.children.map((child) => child.displayName) ?? []),
    ]),
    transactionHash: event.transaction.hash,
  });

  // Set, never incremented: handlers run twice, so this has to land on the
  // same number both times. Ids start at zero, so the newest counts them all.
  context.SessionCounter.set({
    id: SESSION_COUNTER_ID,
    count: event.params.sessionId + 1n,
  });
});

indexer.onEvent({ contract: "SessionFactory", event: "ChildMarketDeployed" }, async ({ event, context }) => {
  const sessionId = event.params.sessionId.toString();
  const session = await context.Session.get(sessionId);

  if (!session) {
    context.log.error(
      `ChildMarketDeployed for unknown session ${sessionId}: skipping child ${event.params.childMarket}`,
    );

    return;
  }

  const outcomeIndex = Number(event.params.parentOutcomeIndex);

  const [metadata, market] = await Promise.all([
    context.effect(fetchSessionMetadata, { path: ipfsPath(session.metadataUri) }),
    context.effect(fetchChildMarket, { chainId: event.chainId, address: event.params.childMarket }),
  ]);

  const display = metadata?.children.find((child) => child.outcomeIndex === outcomeIndex) ?? null;

  context.ChildMarket.set({
    id: event.params.childMarket,
    session_id: sessionId,
    parentOutcomeIndex: event.params.parentOutcomeIndex,
    parentOutcome: session.outcomes[outcomeIndex] ?? "",
    deployedAt: BigInt(event.block.timestamp),
    marketName: market.marketName,
    lowerBound: market.lowerBound,
    upperBound: market.upperBound,
    displayName: display?.displayName,
    color: display?.color,
    blocks: display?.blocks ?? [],
    keyword: keywordOf([market.marketName, display?.displayName]),
    transactionHash: event.transaction.hash,
  });

  const deployedChildCount = session.deployedChildCount + 1n;

  context.Session.set({
    ...session,
    deployedChildCount,
    completedAt: deployedChildCount === session.outcomeCount ? BigInt(event.block.timestamp) : session.completedAt,
  });
});

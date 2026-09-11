import { indexer } from "envio";

import { ipfsPath } from "../utils";
import { fetchChildMarket } from "../utils/contracts/fetchChildMarket";
import { fetchCollateral } from "../utils/contracts/fetchCollateral";
import { fetchOpeningTime } from "../utils/contracts/fetchOpeningTime";
import { fetchParentMarket } from "../utils/contracts/fetchParentMarket";
import { fetchToken } from "../utils/contracts/fetchToken";
import { fetchSessionMetadata } from "../utils/ipfs/fetchSessionMetadata";
import { isAvailable, UNAVAILABLE } from "../utils/unavailable";

const keywordOf = (parts: (string | null | undefined)[]): string => parts.filter(Boolean).join(" ");

const SESSION_COUNTER_ID = "global";

indexer.onEvent({ contract: "SessionFactory", event: "ParentMarketDeployed" }, async ({ event, context }) => {
  const outcomeCount = Number(event.params.outcomeCount);

  const [market, metadata, openingTime, collateral] = await Promise.all([
    context.effect(fetchParentMarket, { chainId: event.chainId, address: event.params.parentMarket, outcomeCount }),
    context.effect(fetchSessionMetadata, { path: ipfsPath(event.params.metadataUri) }),
    context.effect(fetchOpeningTime, { chainId: event.chainId, address: event.params.parentMarket }),
    context.effect(fetchCollateral, { chainId: event.chainId, factory: event.srcAddress }),
  ]);

  context.Session.set({
    id: event.params.sessionId.toString(),
    sessionId: event.params.sessionId,
    deployer: event.params.deployer.toLowerCase(),
    parentMarket: event.params.parentMarket.toLowerCase(),
    outcomeCount: event.params.outcomeCount,
    deployedChildCount: 0n,
    openedAt: BigInt(event.block.timestamp),
    completedAt: 0n,
    marketName: market.marketName,
    outcomes: market.outcomes,
    invalidToken: market.invalidToken ?? undefined,
    collateralToken: collateral.token ?? undefined,
    collateralDecimals: collateral.decimals ?? undefined,
    collateralSymbol: collateral.symbol ?? undefined,
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

  // An absolute set from the event, so any replay lands on the same number.
  // Ids start at zero, so the newest counts them all.
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
  const childMarket = event.params.childMarket.toLowerCase();

  const [metadata, market] = await Promise.all([
    context.effect(fetchSessionMetadata, { path: ipfsPath(session.metadataUri) }),
    context.effect(fetchChildMarket, { chainId: event.chainId, address: event.params.childMarket }),
  ]);

  const display = metadata?.children.find((child) => child.outcomeIndex === outcomeIndex) ?? null;

  const sides = (
    [
      [market.down, 0],
      [market.up, 1],
      [market.underlying, undefined],
    ] as const
  ).filter(([address]) => isAvailable(address));
  const metas = await Promise.all(
    sides.map(([address]) => context.effect(fetchToken, { chainId: event.chainId, address })),
  );
  sides.forEach(([address, side], index) => {
    context.Token.set({
      id: address,
      childMarket_id: childMarket,
      outcomeIndex: side,
      decimals: metas[index]?.decimals ?? undefined,
      symbol: metas[index]?.symbol ?? undefined,
    });
  });

  context.ChildMarket.set({
    id: childMarket,
    session_id: sessionId,
    parentOutcomeIndex: event.params.parentOutcomeIndex,
    parentOutcome: session.outcomes[outcomeIndex] ?? UNAVAILABLE,
    deployedAt: BigInt(event.block.timestamp),
    marketName: market.marketName,
    lowerBound: market.lowerBound,
    upperBound: market.upperBound,
    downToken: market.down,
    upToken: market.up,
    underlyingToken: market.underlying,
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

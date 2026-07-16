import { BigInt } from "@graphprotocol/graph-ts";

import { ChildMarketDeployed as ChildMarketDeployedEvent } from "../../generated/SessionFactory/SessionFactory";
import { SeerMarket } from "../../generated/SessionFactory/SeerMarket";
import { ChildMarket, Session } from "../../generated/schema";

export function createChildMarketFromEvent(event: ChildMarketDeployedEvent): void {
  const sessionId = event.params.sessionId.toString();
  const session = Session.load(sessionId);
  if (!session) {
    return;
  }

  const outcomeIndex = event.params.parentOutcomeIndex.toI32();
  const outcomes = session.outcomes;

  const childContract = SeerMarket.bind(event.params.childMarket);
  const child = new ChildMarket(event.params.childMarket.toHexString());

  child.session = sessionId;
  child.parentOutcomeIndex = event.params.parentOutcomeIndex;
  child.parentOutcome = outcomes[outcomeIndex] ? outcomes[outcomeIndex] : "";
  child.deployedAt = event.block.timestamp;
  child.transactionHash = event.transaction.hash;

  const marketNameCall = childContract.try_marketName();
  child.marketName = marketNameCall.reverted ? "" : marketNameCall.value;

  const lowerBoundCall = childContract.try_lowerBound();
  child.lowerBound = lowerBoundCall.reverted ? BigInt.zero() : lowerBoundCall.value;

  const upperBoundCall = childContract.try_upperBound();
  child.upperBound = upperBoundCall.reverted ? BigInt.zero() : upperBoundCall.value;

  child.keyword = [child.marketName, child.parentOutcome].join(" ");
  child.save();

  session.deployedChildCount = session.deployedChildCount.plus(BigInt.fromI32(1));
  if (session.deployedChildCount.equals(session.outcomeCount)) {
    session.completedAt = event.block.timestamp;
  }
  session.save();
}

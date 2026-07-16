import { BigInt } from "@graphprotocol/graph-ts";

import { ParentMarketDeployed as ParentMarketDeployedEvent } from "../../generated/SessionFactory/SessionFactory";
import { SeerMarket } from "../../generated/SessionFactory/SeerMarket";
import { Session } from "../../generated/schema";

export function createSessionFromEvent(event: ParentMarketDeployedEvent): void {
  const sessionId = event.params.sessionId;
  const session = new Session(sessionId.toString());

  const market = SeerMarket.bind(event.params.parentMarket);
  const outcomes: string[] = [];

  session.sessionId = sessionId;
  session.deployer = event.params.deployer;
  session.parentMarket = event.params.parentMarket;
  session.outcomeCount = event.params.outcomeCount;
  session.deployedChildCount = BigInt.zero();
  session.openedAt = event.block.timestamp;
  session.completedAt = BigInt.zero();
  session.transactionHash = event.transaction.hash;

  const marketNameCall = market.try_marketName();
  session.marketName = marketNameCall.reverted ? "" : marketNameCall.value;

  for (let i = 0; i < event.params.outcomeCount.toI32(); i++) {
    const outcomeCall = market.try_outcomes(BigInt.fromI32(i));
    if (!outcomeCall.reverted) {
      outcomes.push(outcomeCall.value);
    } else {
      outcomes.push("");
    }
  }

  session.outcomes = outcomes;
  session.keyword = [session.marketName].concat(outcomes).join(" ");
  session.save();
}

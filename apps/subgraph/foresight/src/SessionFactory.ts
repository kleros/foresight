import {
  ChildMarketDeployed as ChildMarketDeployedEvent,
  ParentMarketDeployed as ParentMarketDeployedEvent,
} from "../generated/SessionFactory/SessionFactory";
import { createChildMarketFromEvent } from "./entities/ChildMarket";
import { createSessionFromEvent } from "./entities/Session";

export function handleParentMarketDeployed(event: ParentMarketDeployedEvent): void {
  createSessionFromEvent(event);
}

export function handleChildMarketDeployed(event: ChildMarketDeployedEvent): void {
  createChildMarketFromEvent(event);
}

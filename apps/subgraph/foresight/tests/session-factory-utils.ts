import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import { createMockedFunction, newTypedMockEventWithParams } from "matchstick-as";

import { ChildMarketDeployed, ParentMarketDeployed } from "../generated/SessionFactory/SessionFactory";

export const DEPLOYER = "0x1111111111111111111111111111111111111111";
export const PARENT_MARKET = "0x2222222222222222222222222222222222222222";
export const CHILD_MARKET_0 = "0x3333333333333333333333333333333333333333";
export const CHILD_MARKET_1 = "0x4444444444444444444444444444444444444444";
export const MARKET_NAME = "Which movies will Scooby watch?";
export const OUTCOME_0 = "Movie A";
export const OUTCOME_1 = "Movie B";
export const CHILD_MARKET_NAME_0 = "Child market 0";
export const CHILD_MARKET_NAME_1 = "Child market 1";
export const LOWER_BOUND = 0;
export const UPPER_BOUND = 100;

function mockParentMarketMetadata(): void {
  createMockedFunction(Address.fromString(PARENT_MARKET), "marketName", "marketName():(string)").returns([
    ethereum.Value.fromString(MARKET_NAME),
  ]);

  createMockedFunction(Address.fromString(PARENT_MARKET), "outcomes", "outcomes(uint256):(string)")
    .withArgs([ethereum.Value.fromUnsignedBigInt(BigInt.zero())])
    .returns([ethereum.Value.fromString(OUTCOME_0)]);

  createMockedFunction(Address.fromString(PARENT_MARKET), "outcomes", "outcomes(uint256):(string)")
    .withArgs([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))])
    .returns([ethereum.Value.fromString(OUTCOME_1)]);
}

function mockChildMarketMetadata(childMarket: string, marketName: string, lower: i32, upper: i32): void {
  createMockedFunction(Address.fromString(childMarket), "marketName", "marketName():(string)").returns([
    ethereum.Value.fromString(marketName),
  ]);

  createMockedFunction(Address.fromString(childMarket), "lowerBound", "lowerBound():(uint256)").returns([
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(lower)),
  ]);

  createMockedFunction(Address.fromString(childMarket), "upperBound", "upperBound():(uint256)").returns([
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(upper)),
  ]);
}

export function createParentMarketDeployedEvent(
  sessionId: i32,
  deployer: string = DEPLOYER,
  parentMarket: string = PARENT_MARKET,
  outcomeCount: i32 = 2,
): ParentMarketDeployed {
  mockParentMarketMetadata();

  const params = new Array<ethereum.EventParam>();
  params.push(new ethereum.EventParam("sessionId", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(sessionId))));
  params.push(new ethereum.EventParam("deployer", ethereum.Value.fromAddress(Address.fromString(deployer))));
  params.push(new ethereum.EventParam("parentMarket", ethereum.Value.fromAddress(Address.fromString(parentMarket))));
  params.push(new ethereum.EventParam("outcomeCount", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(outcomeCount))));
  return newTypedMockEventWithParams<ParentMarketDeployed>(params);
}

export function createChildMarketDeployedEvent(
  sessionId: i32,
  parentOutcomeIndex: i32,
  childMarket: string,
  parentMarket: string = PARENT_MARKET,
): ChildMarketDeployed {
  mockChildMarketMetadata(
    childMarket,
    parentOutcomeIndex == 0 ? CHILD_MARKET_NAME_0 : CHILD_MARKET_NAME_1,
    LOWER_BOUND,
    UPPER_BOUND,
  );

  const params = new Array<ethereum.EventParam>();
  params.push(new ethereum.EventParam("sessionId", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(sessionId))));
  params.push(
    new ethereum.EventParam(
      "parentOutcomeIndex",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(parentOutcomeIndex)),
    ),
  );
  params.push(new ethereum.EventParam("childMarket", ethereum.Value.fromAddress(Address.fromString(childMarket))));
  params.push(new ethereum.EventParam("parentMarket", ethereum.Value.fromAddress(Address.fromString(parentMarket))));
  return newTypedMockEventWithParams<ChildMarketDeployed>(params);
}

import { assert, beforeEach, clearStore, describe, test } from "matchstick-as/assembly/index";

import { handleChildMarketDeployed, handleParentMarketDeployed } from "../src/SessionFactory";
import {
  CHILD_MARKET_0,
  CHILD_MARKET_1,
  CHILD_MARKET_NAME_0,
  DEPLOYER,
  LOWER_BOUND,
  MARKET_NAME,
  OUTCOME_0,
  OUTCOME_1,
  PARENT_MARKET,
  UPPER_BOUND,
  createChildMarketDeployedEvent,
  createParentMarketDeployedEvent,
} from "./session-factory-utils";

const SESSION_ID = 0;
const SESSION_ID_STRING = "0";

describe("SessionFactory indexing", () => {
  beforeEach(() => {
    clearStore();
  });

  test("indexes atomic deploy as a completed session", () => {
    handleParentMarketDeployed(createParentMarketDeployedEvent(SESSION_ID));
    handleChildMarketDeployed(createChildMarketDeployedEvent(SESSION_ID, 0, CHILD_MARKET_0));
    handleChildMarketDeployed(createChildMarketDeployedEvent(SESSION_ID, 1, CHILD_MARKET_1));

    assert.fieldEquals("Session", SESSION_ID_STRING, "sessionId", SESSION_ID_STRING);
    assert.fieldEquals("Session", SESSION_ID_STRING, "deployer", DEPLOYER);
    assert.fieldEquals("Session", SESSION_ID_STRING, "parentMarket", PARENT_MARKET);
    assert.fieldEquals("Session", SESSION_ID_STRING, "outcomeCount", "2");
    assert.fieldEquals("Session", SESSION_ID_STRING, "deployedChildCount", "2");
    assert.fieldEquals("Session", SESSION_ID_STRING, "completedAt", "1");
    assert.fieldEquals("Session", SESSION_ID_STRING, "marketName", MARKET_NAME);
    assert.fieldEquals("Session", SESSION_ID_STRING, "outcomes", `[${OUTCOME_0}, ${OUTCOME_1}]`);

    assert.fieldEquals("ChildMarket", CHILD_MARKET_0, "session", SESSION_ID_STRING);
    assert.fieldEquals("ChildMarket", CHILD_MARKET_0, "parentOutcomeIndex", "0");
    assert.fieldEquals("ChildMarket", CHILD_MARKET_0, "parentOutcome", OUTCOME_0);
    assert.fieldEquals("ChildMarket", CHILD_MARKET_0, "marketName", CHILD_MARKET_NAME_0);
    assert.fieldEquals("ChildMarket", CHILD_MARKET_0, "lowerBound", LOWER_BOUND.toString());
    assert.fieldEquals("ChildMarket", CHILD_MARKET_0, "upperBound", UPPER_BOUND.toString());
    assert.fieldEquals("ChildMarket", CHILD_MARKET_1, "parentOutcomeIndex", "1");
    assert.fieldEquals("ChildMarket", CHILD_MARKET_1, "parentOutcome", OUTCOME_1);
  });

  test("indexes phased deploy progress from child deploy events", () => {
    handleParentMarketDeployed(createParentMarketDeployedEvent(SESSION_ID));
    handleChildMarketDeployed(createChildMarketDeployedEvent(SESSION_ID, 0, CHILD_MARKET_0));

    assert.fieldEquals("Session", SESSION_ID_STRING, "deployedChildCount", "1");
    assert.fieldEquals("Session", SESSION_ID_STRING, "completedAt", "0");
    assert.fieldEquals("ChildMarket", CHILD_MARKET_0, "parentOutcomeIndex", "0");

    handleChildMarketDeployed(createChildMarketDeployedEvent(SESSION_ID, 1, CHILD_MARKET_1));

    assert.fieldEquals("Session", SESSION_ID_STRING, "deployedChildCount", "2");
    assert.fieldEquals("Session", SESSION_ID_STRING, "completedAt", "1");
    assert.fieldEquals("ChildMarket", CHILD_MARKET_1, "parentOutcomeIndex", "1");
    assert.fieldEquals("ChildMarket", CHILD_MARKET_1, "lowerBound", LOWER_BOUND.toString());
    assert.fieldEquals("ChildMarket", CHILD_MARKET_1, "upperBound", UPPER_BOUND.toString());
  });
});

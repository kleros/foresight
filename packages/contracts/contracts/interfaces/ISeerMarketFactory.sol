// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// https://github.com/seer-pm/seer-pm/blob/main/contracts/src/MarketFactory.sol
interface ISeerMarketFactory {
  struct CreateMarketParams {
    string marketName;
    string[] outcomes;
    string questionStart;
    string questionEnd;
    string outcomeType;
    uint256 parentOutcome;
    address parentMarket;
    string category;
    string lang;
    uint256 lowerBound;
    uint256 upperBound;
    uint256 minBond;
    uint32 openingTime;
    string[] tokenNames;
  }

  function createCategoricalMarket(CreateMarketParams calldata params) external returns (address);

  function createMultiCategoricalMarket(CreateMarketParams calldata params) external returns (address);

  function createScalarMarket(CreateMarketParams calldata params) external returns (address);
}

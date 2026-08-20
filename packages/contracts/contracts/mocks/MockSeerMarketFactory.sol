// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISeerMarketFactory} from "../interfaces/ISeerMarketFactory.sol";
import {MockSeerMarket} from "./MockSeerMarket.sol";

/// @title MockSeerMarketFactory
/// @notice Mock for Seer `MarketFactory`; deploys a `MockSeerMarket` stub per call.
/// @dev Not for production deployment.
contract MockSeerMarketFactory is ISeerMarketFactory {
  /// @notice Market kinds surfaced by the mock for test assertions.
  enum MarketKind {
    Categorical,
    MultiCategorical,
    Scalar
  }

  /// @notice Number of markets created through this mock.
  uint256 public marketCount;

  /// @notice Kind of the most recent market creation call.
  MarketKind public lastMarketKind;

  /// @notice Parent market kind of the most recent parent creation call.
  MarketKind public lastParentMarketKind;

  /// @notice Parameters forwarded on the most recent market creation call.
  ISeerMarketFactory.CreateMarketParams public lastParams;

  /// @notice Outcome labels from `lastParams`.
  function lastOutcomes() external view returns (string[] memory) {
    return lastParams.outcomes;
  }

  /// @notice Token names from `lastParams`.
  function lastTokenNames() external view returns (string[] memory) {
    return lastParams.tokenNames;
  }

  /// @inheritdoc ISeerMarketFactory
  function createMultiCategoricalMarket(CreateMarketParams calldata params) external returns (address market) {
    lastMarketKind = MarketKind.MultiCategorical;
    lastParentMarketKind = MarketKind.MultiCategorical;
    lastParams = params;
    market = _deployMarket(params);
  }

  /// @inheritdoc ISeerMarketFactory
  function createCategoricalMarket(CreateMarketParams calldata params) external returns (address market) {
    lastMarketKind = MarketKind.Categorical;
    lastParentMarketKind = MarketKind.Categorical;
    lastParams = params;
    market = _deployMarket(params);
  }

  /// @inheritdoc ISeerMarketFactory
  function createScalarMarket(CreateMarketParams calldata params) external returns (address market) {
    lastMarketKind = MarketKind.Scalar;
    lastParams = params;
    market = _deployMarket(params);
  }

  /// @notice Deploys the market stub for this creation call.
  /// @param params Market creation params forwarded by the caller.
  /// @return market Address of the deployed `MockSeerMarket`.
  function _deployMarket(CreateMarketParams calldata params) private returns (address market) {
    marketCount++;
    market = address(
      new MockSeerMarket(
        params.marketName,
        params.outcomes,
        params.lowerBound,
        params.upperBound,
        params.parentMarket,
        params.parentOutcome,
        params.openingTime
      )
    );
  }
}

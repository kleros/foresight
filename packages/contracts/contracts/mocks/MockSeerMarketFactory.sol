// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISeerMarketFactory} from "../interfaces/ISeerMarketFactory.sol";

/// @title MockSeerMarketFactory
/// @notice Mock for Seer `MarketFactory`; returns deterministic pseudo-addresses per call.
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
    market = _nextMarket("multi");
  }

  /// @inheritdoc ISeerMarketFactory
  function createCategoricalMarket(CreateMarketParams calldata params) external returns (address market) {
    lastMarketKind = MarketKind.Categorical;
    lastParentMarketKind = MarketKind.Categorical;
    lastParams = params;
    market = _nextMarket("cat");
  }

  /// @inheritdoc ISeerMarketFactory
  function createScalarMarket(CreateMarketParams calldata params) external returns (address market) {
    lastMarketKind = MarketKind.Scalar;
    lastParams = params;
    market = _nextMarket("scalar");
  }

  /// @notice Allocates the next deterministic pseudo market address.
  /// @param kind Market kind label mixed into the address hash.
  /// @return market Pseudo market address for tests.
  /// @dev O(1).
  function _nextMarket(string memory kind) private returns (address market) {
    marketCount++;
    market = address(
      uint160(uint256(keccak256(abi.encodePacked(kind, marketCount, msg.sender, block.timestamp, block.prevrandao))))
    );
  }
}

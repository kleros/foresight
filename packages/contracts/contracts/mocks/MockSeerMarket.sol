// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MockSeerMarket
/// @notice Minimal stand-in for Seer `Market` exposing the views read off-chain.
/// @dev Mirrors the storage layout semantics of Seer `Market`: `outcomes` excludes the
///      INVALID_RESULT outcome and `numOutcomes()` is `outcomes.length`. Not for production deployment.
contract MockSeerMarket {
  /// @notice The name of the market.
  string public marketName;

  /// @notice The market outcomes, doesn't include the INVALID_RESULT outcome.
  string[] public outcomes;

  /// @notice Lower bound, only used for scalar markets.
  uint256 public lowerBound;

  /// @notice Upper bound, only used for scalar markets.
  uint256 public upperBound;

  /// @notice Parent market address, zero for top-level markets.
  address public parentMarket;

  /// @notice Parent market outcome index this market is conditional on.
  uint256 public parentOutcome;

  constructor(
    string memory _marketName,
    string[] memory _outcomes,
    uint256 _lowerBound,
    uint256 _upperBound,
    address _parentMarket,
    uint256 _parentOutcome
  ) {
    marketName = _marketName;
    outcomes = _outcomes;
    lowerBound = _lowerBound;
    upperBound = _upperBound;
    parentMarket = _parentMarket;
    parentOutcome = _parentOutcome;
  }

  /// @notice Returns the number of outcomes.
  function numOutcomes() external view returns (uint256) {
    return outcomes.length;
  }
}

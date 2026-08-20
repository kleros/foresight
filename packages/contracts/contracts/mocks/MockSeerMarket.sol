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

  /// @notice Reality question opening time, served through the getters below.
  uint32 internal openingTime;

  constructor(
    string memory _marketName,
    string[] memory _outcomes,
    uint256 _lowerBound,
    uint256 _upperBound,
    address _parentMarket,
    uint256 _parentOutcome,
    uint32 _openingTime
  ) {
    marketName = _marketName;
    outcomes = _outcomes;
    lowerBound = _lowerBound;
    upperBound = _upperBound;
    parentMarket = _parentMarket;
    parentOutcome = _parentOutcome;
    openingTime = _openingTime;
  }

  /// @notice Reality question ids; one, as Seer creates for a categorical market.
  /// @dev Derived from the address so two mock markets never share an id.
  function questionsIds() external view returns (bytes32[] memory ids) {
    ids = new bytes32[](1);
    ids[0] = keccak256(abi.encodePacked(address(this)));
  }

  /// @notice Stands in for Seer's RealityProxy, a separate contract on a real deploy.
  /// @dev Market, proxy and Reality are one here so the off-chain walk resolves unchanged.
  function realityProxy() external view returns (address) {
    return address(this);
  }

  /// @notice Stands in for `RealityProxy.realitio`.
  function realitio() external view returns (address) {
    return address(this);
  }

  /// @notice Stands in for Reality's `getOpeningTS`.
  function getOpeningTS(bytes32) external view returns (uint32) {
    return openingTime;
  }

  /// @notice Returns the number of outcomes.
  function numOutcomes() external view returns (uint256) {
    return outcomes.length;
  }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockERC20} from "./MockERC20.sol";

/// @title MockCallTarget
/// @notice Stands in for whatever the executor is pointed at.
/// @dev Not for production deployment.
contract MockCallTarget {
  /// @dev Seer's router and the Algebra pools revert with strings.
  function revertWithReason(string calldata reason) external pure {
    revert(reason);
  }

  /// @dev Reverts with empty returndata, leaving the caller nothing to surface.
  function revertSilently() external pure {
    // solhint-disable-next-line gas-custom-errors, reason-string
    require(false);
  }

  /// @notice Mints collateral equal to the native currency sent, as unwrapping into a deposit does.
  function mintFromValue(MockERC20 collateral) external payable {
    collateral.mint(msg.sender, msg.value);
  }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title TradeExecutor
/// @notice User-owned contract that holds collateral and executes trades on the owner's behalf.
contract TradeExecutor {
  // ************************************* //
  // *         Enums / Structs           * //
  // ************************************* //

  struct Call {
    address to;
    bytes data;
  }

  struct ValueCall {
    address to;
    uint256 value;
    bytes data;
  }

  // ************************************* //
  // *             Storage               * //
  // ************************************* //

  address public immutable owner;

  modifier onlyOwner() {
    if (msg.sender != owner) revert NotOwner();
    _;
  }

  // ************************************* //
  // *            Constructor            * //
  // ************************************* //

  constructor(address _owner) {
    if (_owner == address(0)) revert ZeroOwner();
    owner = _owner;
  }

  // ************************************* //
  // *         State Modifiers           * //
  // ************************************* //

  function batchExecute(Call[] calldata calls) external onlyOwner {
    uint256 callCount = calls.length;
    if (callCount == 0) revert EmptyBatch();

    for (uint256 i = 0; i < callCount; i++) {
      _call(calls[i].to, 0, calls[i].data);
    }
  }

  function batchValueExecute(ValueCall[] calldata calls) external payable onlyOwner {
    uint256 callCount = calls.length;
    if (callCount == 0) revert EmptyBatch();

    for (uint256 i = 0; i < callCount; i++) {
      _call(calls[i].to, calls[i].value, calls[i].data);
    }
  }

  // solhint-disable-next-line no-empty-blocks
  receive() external payable {}

  // ************************************* //
  // *            Internal               * //
  // ************************************* //

  function _call(address to, uint256 value, bytes calldata data) private {
    if (data.length != 0 && to.code.length == 0) revert TargetHasNoCode(to);

    // solhint-disable-next-line avoid-low-level-calls
    (bool success, bytes memory returnData) = to.call{value: value}(data);
    if (success) return;

    if (returnData.length == 0) revert CallFailed();
    // solhint-disable-next-line no-inline-assembly
    assembly {
      revert(add(returnData, 0x20), mload(returnData))
    }
  }

  // ************************************* //
  // *              Errors               * //
  // ************************************* //

  error NotOwner();

  error ZeroOwner();

  error EmptyBatch();

  error CallFailed();

  error TargetHasNoCode(address target);
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TradeExecutor} from "./TradeExecutor.sol";

/// @title TradeExecutorFactory
/// @notice CREATE2 deployer for trade executors, one per account.
/// @dev An account can only ever deploy its executor.
contract TradeExecutorFactory {
  // ************************************* //
  // *             Storage               * //
  // ************************************* //

  string public constant SALT_KEY = "foresight.trade-executor.v1";

  // ************************************* //
  // *              Events               * //
  // ************************************* //

  event ExecutorDeployed(address indexed owner, address indexed executor);

  // ************************************* //
  // *         State Modifiers           * //
  // ************************************* //

  function createExecutor() external returns (address executor) {
    if (executorOf(msg.sender) != address(0)) revert ExecutorAlreadyDeployed();

    executor = address(new TradeExecutor{salt: saltFor(msg.sender)}(msg.sender));

    emit ExecutorDeployed(msg.sender, executor);
  }

  // ************************************* //
  // *           Public Views            * //
  // ************************************* //

  function predictExecutor(address owner) public view returns (address executor) {
    bytes32 initCodeHash = keccak256(abi.encodePacked(type(TradeExecutor).creationCode, abi.encode(owner)));
    bytes32 create2Hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), saltFor(owner), initCodeHash));

    executor = address(uint160(uint256(create2Hash)));
  }

  function executorOf(address owner) public view returns (address executor) {
    address predicted = predictExecutor(owner);

    executor = predicted.code.length == 0 ? address(0) : predicted;
  }

  function saltFor(address owner) public pure returns (bytes32 salt) {
    salt = keccak256(abi.encodePacked(SALT_KEY, owner));
  }

  // ************************************* //
  // *              Errors               * //
  // ************************************* //

  error ExecutorAlreadyDeployed();
}

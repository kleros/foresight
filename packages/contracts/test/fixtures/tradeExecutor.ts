import hre from "hardhat";
import { parseEther } from "ethers";

import type { MockCallTarget, MockERC20, TradeExecutor, TradeExecutorFactory } from "../../typechain-types";
import {
  MockCallTarget__factory,
  MockERC20__factory,
  TradeExecutor__factory,
  TradeExecutorFactory__factory,
} from "../../typechain-types";

/** Collateral the executor holds before any leg runs, so every amount below has room to move. */
export const EXECUTOR_COLLATERAL = parseEther("1000");

/** Native currency the executor holds, so value-carrying legs have something to forward. */
export const EXECUTOR_NATIVE = parseEther("5");

export async function deployTradeExecutorFactoryFixture() {
  const [owner, other] = await hre.ethers.getSigners();
  if (!owner || !other) {
    throw new Error("Expected Hardhat signers");
  }

  const factory = (await new TradeExecutorFactory__factory(owner).deploy()) as TradeExecutorFactory;

  return { owner, other, factory };
}

export async function deployTradeExecutorFixture() {
  const { owner, other, factory } = await deployTradeExecutorFactoryFixture();

  // the create2 address the EVM actually lands on, rather than the one `predictExecutor` says it will
  const executorAddress = await factory.connect(owner).createExecutor.staticCall();
  await factory.connect(owner).createExecutor();
  const executor = TradeExecutor__factory.connect(executorAddress, owner) as TradeExecutor;

  const collateral = (await new MockERC20__factory(owner).deploy("Savings DAI", "sDAI")) as MockERC20;
  const target = (await new MockCallTarget__factory(owner).deploy()) as MockCallTarget;

  await collateral.mint(executorAddress, EXECUTOR_COLLATERAL);
  await owner.sendTransaction({ to: executorAddress, value: EXECUTOR_NATIVE });

  return { owner, other, factory, executor, executorAddress, collateral, target };
}

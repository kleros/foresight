import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import hre from "hardhat";

async function tradeExecutorFactoryDeployFixture() {
  await hre.deployments.fixture(["TradeExecutorFactory"]);
  return hre.deployments;
}

describe("deploy/02_trade_executor_factory", function () {
  it("deploys a TradeExecutorFactory", async function () {
    const deployments = await loadFixture(tradeExecutorFactoryDeployFixture);
    const [deployer] = await hre.ethers.getSigners();
    if (!deployer) {
      throw new Error("Expected Hardhat signers");
    }

    const deployment = await deployments.get("TradeExecutorFactory");
    const factory = await hre.ethers.getContractAt("TradeExecutorFactory", deployment.address);

    expect(await factory.predictExecutor(deployer.address)).to.not.equal(hre.ethers.ZeroAddress);
    expect(await factory.executorOf(deployer.address)).to.equal(hre.ethers.ZeroAddress);
  });
});

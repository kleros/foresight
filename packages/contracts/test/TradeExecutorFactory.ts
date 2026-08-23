import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import hre from "hardhat";
import { AbiCoder, concat, getCreate2Address, keccak256, solidityPacked } from "ethers";

import { deployTradeExecutorFactoryFixture } from "./fixtures/tradeExecutor";
import { TradeExecutor__factory } from "../typechain-types";

/** CREATE2 worked through independently of the factory, from the artifact and the salt it publishes. */
async function create2AddressFor(factoryAddress: string, saltKey: string, ownerAddress: string) {
  const { bytecode } = await hre.artifacts.readArtifact("TradeExecutor");
  const initCode = concat([bytecode, AbiCoder.defaultAbiCoder().encode(["address"], [ownerAddress])]);
  const salt = keccak256(solidityPacked(["string", "address"], [saltKey, ownerAddress]));

  return getCreate2Address(factoryAddress, salt, keccak256(initCode));
}

describe("TradeExecutorFactory", function () {
  describe("createExecutor", function () {
    it("deploys an executor controlled by the caller", async function () {
      const { owner, factory } = await loadFixture(deployTradeExecutorFactoryFixture);

      const executorAddress = await factory.connect(owner).createExecutor.staticCall();
      await factory.connect(owner).createExecutor();

      const executor = TradeExecutor__factory.connect(executorAddress, owner);
      expect(await executor.owner()).to.equal(owner.address);
    });

    it("emits the owner and executor the indexer keys participants on", async function () {
      const { owner, factory } = await loadFixture(deployTradeExecutorFactoryFixture);

      const executorAddress = await factory.connect(owner).createExecutor.staticCall();

      await expect(factory.connect(owner).createExecutor())
        .to.emit(factory, "ExecutorDeployed")
        .withArgs(owner.address, executorAddress);
    });

    it("deploys to the address it predicts", async function () {
      const { owner, factory } = await loadFixture(deployTradeExecutorFactoryFixture);

      const predicted = await factory.predictExecutor(owner.address);
      const deployed = await factory.connect(owner).createExecutor.staticCall();

      expect(deployed).to.equal(predicted);
    });

    it("refuses a second executor for the same caller", async function () {
      const { owner, factory } = await loadFixture(deployTradeExecutorFactoryFixture);
      await factory.connect(owner).createExecutor();

      await expect(factory.connect(owner).createExecutor()).to.be.revertedWithCustomError(
        factory,
        "ExecutorAlreadyDeployed",
      );
    });

    it("leaves another account's executor undeployed", async function () {
      const { owner, other, factory } = await loadFixture(deployTradeExecutorFactoryFixture);

      await factory.connect(owner).createExecutor();

      expect(await factory.executorOf(other.address)).to.equal(hre.ethers.ZeroAddress);
    });

    it("gives each caller a different executor", async function () {
      const { owner, other, factory } = await loadFixture(deployTradeExecutorFactoryFixture);

      const first = await factory.connect(owner).createExecutor.staticCall();
      const second = await factory.connect(other).createExecutor.staticCall();

      expect(first).to.not.equal(second);
    });
  });

  describe("predictExecutor", function () {
    it("matches a CREATE2 address worked out off chain", async function () {
      const { owner, factory } = await loadFixture(deployTradeExecutorFactoryFixture);
      const factoryAddress = await factory.getAddress();

      const expected = await create2AddressFor(factoryAddress, await factory.SALT_KEY(), owner.address);

      expect(await factory.predictExecutor(owner.address)).to.equal(expected);
    });

    it("holds regardless of how many executors the factory has already deployed", async function () {
      const { owner, other, factory } = await loadFixture(deployTradeExecutorFactoryFixture);

      const predictedForOther = await factory.predictExecutor(other.address);
      await factory.connect(owner).createExecutor();

      expect(await factory.connect(other).createExecutor.staticCall()).to.equal(predictedForOther);
    });

    it("answers before the executor exists", async function () {
      const { owner, factory } = await loadFixture(deployTradeExecutorFactoryFixture);

      const predicted = await factory.predictExecutor(owner.address);

      expect(predicted).to.not.equal(hre.ethers.ZeroAddress);
      expect(await hre.ethers.provider.getCode(predicted)).to.equal("0x");
    });

    it("keys the salt on the owner, so two owners predict apart", async function () {
      const { owner, other, factory } = await loadFixture(deployTradeExecutorFactoryFixture);

      expect(await factory.saltFor(owner.address)).to.not.equal(await factory.saltFor(other.address));
      expect(await factory.predictExecutor(owner.address)).to.not.equal(await factory.predictExecutor(other.address));
    });
  });

  describe("executorOf", function () {
    it("reports nothing until the executor is deployed", async function () {
      const { owner, factory } = await loadFixture(deployTradeExecutorFactoryFixture);

      expect(await factory.executorOf(owner.address)).to.equal(hre.ethers.ZeroAddress);
    });

    it("reports the deployed executor", async function () {
      const { owner, factory } = await loadFixture(deployTradeExecutorFactoryFixture);

      const executorAddress = await factory.connect(owner).createExecutor.staticCall();
      await factory.connect(owner).createExecutor();

      expect(await factory.executorOf(owner.address)).to.equal(executorAddress);
    });
  });
});

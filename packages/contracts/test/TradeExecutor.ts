import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import hre from "hardhat";
import { parseEther, type ContractTransactionResponse } from "ethers";

import { deployTradeExecutorFixture, EXECUTOR_COLLATERAL, EXECUTOR_NATIVE } from "./fixtures/tradeExecutor";
import { TradeExecutor__factory } from "../typechain-types";

const SPLIT_AMOUNT = parseEther("100");
const VALUE_LEG = parseEther("2");
const WITHDRAWAL = parseEther("250");
const MORE_THAN_HELD = EXECUTOR_COLLATERAL + 1n;

async function logsFromExecutorItself(executorAddress: string, tx: ContractTransactionResponse) {
  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error("Expected a transaction receipt");
  }

  return receipt.logs.filter((log) => log.address === executorAddress);
}

describe("TradeExecutor", function () {
  describe("ownership", function () {
    it("reports the owner it was constructed for", async function () {
      const { owner, executor } = await loadFixture(deployTradeExecutorFixture);

      expect(await executor.owner()).to.equal(owner.address);
    });

    it("refuses to be constructed without an owner", async function () {
      const { owner, executor } = await loadFixture(deployTradeExecutorFixture);

      await expect(new TradeExecutor__factory(owner).deploy(hre.ethers.ZeroAddress)).to.be.revertedWithCustomError(
        executor,
        "ZeroOwner",
      );
    });

    it("refuses arbitrary calls from anyone but the owner", async function () {
      const { other, executor, collateral } = await loadFixture(deployTradeExecutorFixture);
      const approve = collateral.interface.encodeFunctionData("approve", [other.address, WITHDRAWAL]);

      await expect(
        executor.connect(other).batchExecute([{ to: collateral, data: approve }]),
      ).to.be.revertedWithCustomError(executor, "NotOwner");
    });

    it("refuses value-carrying calls from anyone but the owner", async function () {
      const { other, executor } = await loadFixture(deployTradeExecutorFixture);

      await expect(
        executor.connect(other).batchValueExecute([{ to: other.address, value: VALUE_LEG, data: "0x" }]),
      ).to.be.revertedWithCustomError(executor, "NotOwner");
    });
  });

  describe("batchExecute", function () {
    it("runs every call in the batch", async function () {
      const { executor, executorAddress, other, collateral } = await loadFixture(deployTradeExecutorFixture);

      await executor.batchExecute([
        { to: collateral, data: collateral.interface.encodeFunctionData("approve", [other.address, SPLIT_AMOUNT]) },
        { to: collateral, data: collateral.interface.encodeFunctionData("transfer", [other.address, WITHDRAWAL]) },
      ]);

      expect(await collateral.allowance(executorAddress, other.address)).to.equal(SPLIT_AMOUNT);
      expect(await collateral.balanceOf(other.address)).to.equal(WITHDRAWAL);
      expect(await collateral.balanceOf(executorAddress)).to.equal(EXECUTOR_COLLATERAL - WITHDRAWAL);
    });

    it("emits nothing of its own", async function () {
      const { executor, executorAddress, other, collateral } = await loadFixture(deployTradeExecutorFixture);

      const tx = await executor.batchExecute([
        { to: collateral, data: collateral.interface.encodeFunctionData("transfer", [other.address, WITHDRAWAL]) },
      ]);

      expect(await logsFromExecutorItself(executorAddress, tx)).to.have.length(0);
    });

    it("surfaces the reason the target gave", async function () {
      const { executor, target } = await loadFixture(deployTradeExecutorFixture);
      const data = target.interface.encodeFunctionData("revertWithReason", ["no liquidity"]);

      await expect(executor.batchExecute([{ to: target, data }])).to.be.revertedWith("no liquidity");
    });

    it("surfaces the custom error the target threw", async function () {
      const { executor, executorAddress, other, collateral } = await loadFixture(deployTradeExecutorFixture);
      const overdraw = collateral.interface.encodeFunctionData("transfer", [other.address, MORE_THAN_HELD]);

      await expect(executor.batchExecute([{ to: collateral, data: overdraw }]))
        .to.be.revertedWithCustomError(collateral, "ERC20InsufficientBalance")
        .withArgs(executorAddress, EXECUTOR_COLLATERAL, MORE_THAN_HELD);
    });

    it("reports a failure the target gave no reason for", async function () {
      const { executor, target } = await loadFixture(deployTradeExecutorFixture);
      const data = target.interface.encodeFunctionData("revertSilently");

      await expect(executor.batchExecute([{ to: target, data }])).to.be.revertedWithCustomError(executor, "CallFailed");
    });

    it("refuses a batch with no calls", async function () {
      const { executor } = await loadFixture(deployTradeExecutorFixture);

      await expect(executor.batchExecute([])).to.be.revertedWithCustomError(executor, "EmptyBatch");
    });

    it("refuses a call carrying calldata to an address with no code", async function () {
      const { executor, other, collateral } = await loadFixture(deployTradeExecutorFixture);
      const transfer = collateral.interface.encodeFunctionData("transfer", [other.address, WITHDRAWAL]);

      await expect(executor.batchExecute([{ to: other.address, data: transfer }]))
        .to.be.revertedWithCustomError(executor, "TargetHasNoCode")
        .withArgs(other.address);
    });

    it("undoes earlier calls when a later one fails", async function () {
      const { executor, executorAddress, other, collateral, target } = await loadFixture(deployTradeExecutorFixture);
      const transfer = collateral.interface.encodeFunctionData("transfer", [other.address, WITHDRAWAL]);
      const fail = target.interface.encodeFunctionData("revertWithReason", ["too late"]);

      await expect(
        executor.batchExecute([
          { to: collateral, data: transfer },
          { to: target, data: fail },
        ]),
      ).to.be.revertedWith("too late");

      expect(await collateral.balanceOf(executorAddress)).to.equal(EXECUTOR_COLLATERAL);
    });
  });

  describe("batchValueExecute", function () {
    it("forwards native currency held by the executor", async function () {
      const { executor, executorAddress, collateral, target } = await loadFixture(deployTradeExecutorFixture);
      const mintFromValue = target.interface.encodeFunctionData("mintFromValue", [await collateral.getAddress()]);

      await executor.batchValueExecute([{ to: target, value: VALUE_LEG, data: mintFromValue }]);

      expect(await collateral.balanceOf(executorAddress)).to.equal(EXECUTOR_COLLATERAL + VALUE_LEG);
      expect(await hre.ethers.provider.getBalance(executorAddress)).to.equal(EXECUTOR_NATIVE - VALUE_LEG);
    });

    it("forwards native currency sent along with the call", async function () {
      const { executor, executorAddress, collateral, target } = await loadFixture(deployTradeExecutorFixture);
      const mintFromValue = target.interface.encodeFunctionData("mintFromValue", [await collateral.getAddress()]);

      await executor.batchValueExecute([{ to: target, value: EXECUTOR_NATIVE + VALUE_LEG, data: mintFromValue }], {
        value: VALUE_LEG,
      });

      expect(await collateral.balanceOf(executorAddress)).to.equal(EXECUTOR_COLLATERAL + EXECUTOR_NATIVE + VALUE_LEG);
      expect(await hre.ethers.provider.getBalance(executorAddress)).to.equal(0n);
    });

    it("refuses a value batch with no calls", async function () {
      const { executor } = await loadFixture(deployTradeExecutorFixture);

      await expect(executor.batchValueExecute([])).to.be.revertedWithCustomError(executor, "EmptyBatch");
    });
  });

  describe("holding value", function () {
    it("accepts a plain native transfer", async function () {
      const { executorAddress, other } = await loadFixture(deployTradeExecutorFixture);

      await other.sendTransaction({ to: executorAddress, value: VALUE_LEG });

      expect(await hre.ethers.provider.getBalance(executorAddress)).to.equal(EXECUTOR_NATIVE + VALUE_LEG);
    });

    it("lets the owner take everything back out", async function () {
      const { executor, executorAddress, other, collateral } = await loadFixture(deployTradeExecutorFixture);
      const sweep = collateral.interface.encodeFunctionData("transfer", [other.address, EXECUTOR_COLLATERAL]);

      await executor.batchExecute([{ to: collateral, data: sweep }]);
      await executor.batchValueExecute([{ to: other.address, value: EXECUTOR_NATIVE, data: "0x" }]);

      expect(await collateral.balanceOf(executorAddress)).to.equal(0n);
      expect(await hre.ethers.provider.getBalance(executorAddress)).to.equal(0n);
    });
  });
});

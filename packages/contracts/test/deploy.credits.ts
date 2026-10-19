import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import hre from "hardhat";

import { SEED_CREDITS, SEED_MANAGER_SDAI } from "../deploy/03_credits";

async function creditsDeployFixture() {
  await hre.deployments.fixture(["Credits"]);
  const [deployer, bob] = await hre.ethers.getSigners();
  if (!deployer || !bob) {
    throw new Error("Expected Hardhat signers");
  }
  const sDai = await hre.ethers.getContractAt("MockERC20", (await hre.deployments.get("SavingsXDai")).address);
  const credits = await hre.ethers.getContractAt(
    "SeerCredits",
    (await hre.deployments.get("ForesightCredits")).address,
  );
  const manager = await hre.ethers.getContractAt(
    "CreditsManager",
    (await hre.deployments.get("CreditsManager")).address,
  );
  return { deployer, alice: deployer, bob, sDai, credits, manager };
}

describe("deploy/03_credits", function () {
  it("backs the manager with the local sDAI and lets it burn the credits", async function () {
    const { deployer, sDai, credits, manager } = await loadFixture(creditsDeployFixture);

    expect(await manager.token()).to.equal(await sDai.getAddress());
    expect(await manager.seerCredits()).to.equal(await credits.getAddress());
    expect(await credits.creditsManager()).to.equal(await manager.getAddress());
    expect(await credits.governor()).to.equal(deployer.address);
    expect(await manager.governor()).to.equal(deployer.address);
  });

  it("grants alice and bob credits the funded manager can cover", async function () {
    const { alice, bob, sDai, credits, manager } = await loadFixture(creditsDeployFixture);

    expect(await credits.balanceOf(alice.address)).to.equal(SEED_CREDITS);
    expect(await credits.balanceOf(bob.address)).to.equal(SEED_CREDITS);
    expect(await credits.totalSupply()).to.equal(SEED_CREDITS * 2n);
    expect(await sDai.balanceOf(await manager.getAddress())).to.equal(SEED_MANAGER_SDAI);
    expect(await manager.canSpendCredits(alice.address, SEED_CREDITS)).to.equal(true);
    expect(await manager.canSpendCredits(alice.address, SEED_CREDITS + 1n)).to.equal(false);
  });

  it("does not seed again when rerun against a node that already has the manager", async function () {
    const { alice, sDai, credits, manager } = await loadFixture(creditsDeployFixture);

    await hre.deployments.run(["Credits"], { resetMemory: false, deletePreviousDeployments: false });

    expect(await credits.balanceOf(alice.address)).to.equal(SEED_CREDITS);
    expect(await sDai.balanceOf(await manager.getAddress())).to.equal(SEED_MANAGER_SDAI);
  });

  it("whitelists nothing, so no local spend can route through the manager", async function () {
    const { alice, manager } = await loadFixture(creditsDeployFixture);

    await expect(manager.connect(alice).execute(alice.address, "0x", 1n, await manager.token())).to.be.revertedWith(
      "Contract not whitelisted",
    );
  });
});

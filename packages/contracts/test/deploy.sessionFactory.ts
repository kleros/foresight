import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import hre from "hardhat";

async function sessionFactoryDeployFixture() {
  await hre.deployments.fixture(["SessionFactory"]);
  return hre.deployments;
}

describe("deploy/01_session_factory", function () {
  it("deploys SessionFactory wired to MockSeerMarketFactory on hardhat", async function () {
    const deployments = await loadFixture(sessionFactoryDeployFixture);

    const sessionFactoryDeployment = await deployments.get("SessionFactory");
    const mockDeployment = await deployments.get("MockSeerMarketFactory");
    const sessionFactory = await hre.ethers.getContractAt("SessionFactory", sessionFactoryDeployment.address);

    expect(await sessionFactory.seerMarketFactory()).to.equal(mockDeployment.address);
    expect(sessionFactoryDeployment.args?.[0]).to.equal(mockDeployment.address);
  });
});

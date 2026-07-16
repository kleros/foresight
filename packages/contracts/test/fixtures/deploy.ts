import hre from "hardhat";

import type { MockSeerMarketFactory, SessionFactory } from "../../typechain-types";
import { MockSeerMarketFactory__factory, SessionFactory__factory } from "../../typechain-types";

export async function deploySessionFactoryFixture() {
  const [deployer, other] = await hre.ethers.getSigners();
  if (!deployer || !other) {
    throw new Error("Expected Hardhat signers");
  }

  const seerMarketFactory = (await new MockSeerMarketFactory__factory(deployer).deploy()) as MockSeerMarketFactory;
  const sessionFactory = (await new SessionFactory__factory(deployer).deploy(
    await seerMarketFactory.getAddress(),
  )) as SessionFactory;

  return { deployer, other, seerMarketFactory, sessionFactory };
}

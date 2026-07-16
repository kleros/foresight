import type { DeployFunction } from "hardhat-deploy/types";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

import { resolveSeerMarketFactory } from "../config/deploy";

const deploySessionFactory: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployments, getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();
  if (!deployer) {
    throw new Error("Named account 'deployer' is not configured");
  }

  const resolution = await resolveSeerMarketFactory(hre);
  let seerMarketFactoryAddress: string;

  switch (resolution.kind) {
    case "env":
      seerMarketFactoryAddress = resolution.address;
      console.log(`Using Seer MarketFactory from SEER_MARKET_FACTORY_ADDRESS: ${seerMarketFactoryAddress}`);
      break;
    case "config":
      seerMarketFactoryAddress = resolution.address;
      console.log(
        `Using Seer MarketFactory from config on chain ${await hre.getChainId()}: ${seerMarketFactoryAddress}`,
      );
      break;
    case "mock": {
      const mock = await deployments.deploy("MockSeerMarketFactory", {
        contract: "MockSeerMarketFactory",
        from: deployer,
        args: [],
        log: true,
      });
      seerMarketFactoryAddress = mock.address;
      console.log(`Deployed MockSeerMarketFactory for local chain: ${seerMarketFactoryAddress}`);
      break;
    }
  }

  const sessionFactory = await deployments.deploy("SessionFactory", {
    contract: "SessionFactory",
    from: deployer,
    args: [seerMarketFactoryAddress],
    log: true,
  });

  console.log(`SessionFactory deployed to ${sessionFactory.address}`);
};

deploySessionFactory.tags = ["SessionFactory"];
deploySessionFactory.id = "SessionFactory";

export default deploySessionFactory;

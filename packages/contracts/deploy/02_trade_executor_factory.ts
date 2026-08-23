import type { DeployFunction } from "hardhat-deploy/types";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

const deployTradeExecutorFactory: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployments, getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();
  if (!deployer) {
    throw new Error("Named account 'deployer' is not configured");
  }

  const tradeExecutorFactory = await deployments.deploy("TradeExecutorFactory", {
    contract: "TradeExecutorFactory",
    from: deployer,
    args: [],
    log: true,
  });

  console.log(`TradeExecutorFactory deployed to ${tradeExecutorFactory.address}`);
};

deployTradeExecutorFactory.tags = ["TradeExecutorFactory"];
deployTradeExecutorFactory.id = "TradeExecutorFactory";

export default deployTradeExecutorFactory;

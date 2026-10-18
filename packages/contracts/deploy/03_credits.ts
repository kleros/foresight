import type { DeployFunction } from "hardhat-deploy/types";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { parseEther } from "viem";

import { isLocalDeployChain } from "../config/deploy";

/** Granted to each of hardhat's first two accounts (alice and bob in the app). */
export const SEED_CREDITS = parseEther("100");
export const SEED_MANAGER_SDAI = parseEther("1000");

/**
 * Local stand-in for Gnosis' credits: a mintable sDAI, the credits token and its manager.
 * Gnosis uses the live pair, whose addresses sit in deployments/external/gnosis.
 */
const deployCredits: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployments, getNamedAccounts } = hre;
  const { deployer, alice, bob } = await getNamedAccounts();
  if (!deployer || !alice || !bob) {
    throw new Error("Named accounts 'deployer', 'alice' and 'bob' must be configured");
  }

  const sDai = await deployments.deploy("SavingsXDai", {
    contract: "MockERC20",
    from: deployer,
    args: ["Savings xDAI", "sDAI"],
    log: true,
  });

  const credits = await deployments.deploy("ForesightCredits", {
    contract: "SeerCredits",
    from: deployer,
    args: [deployer],
    log: true,
  });

  const manager = await deployments.deploy("CreditsManager", {
    contract: "CreditsManager",
    from: deployer,
    args: [sDai.address, credits.address],
    log: true,
  });

  // The token's burner starts as its governor; the manager burns on every spend.
  const burner = (await deployments.read("ForesightCredits", "creditsManager")) as string;
  if (burner.toLowerCase() !== manager.address.toLowerCase()) {
    await deployments.execute(
      "ForesightCredits",
      { from: deployer, log: true },
      "changeCreditsManager",
      manager.address,
    );
  }

  // Seeds only the deployment that created this manager.
  if (!manager.newlyDeployed) return;

  await deployments.execute(
    "ForesightCredits",
    { from: deployer, log: true },
    "addCreditsBalance",
    [alice, bob],
    [SEED_CREDITS, SEED_CREDITS],
  );
  await deployments.execute("SavingsXDai", { from: deployer, log: true }, "mint", manager.address, SEED_MANAGER_SDAI);
};

deployCredits.tags = ["Credits"];
deployCredits.id = "Credits";
deployCredits.skip = async (hre) => !isLocalDeployChain(Number(await hre.getChainId()));

export default deployCredits;

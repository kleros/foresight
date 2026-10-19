import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-solhint";
import "@typechain/hardhat";
import "hardhat-deploy";
import "hardhat-deploy-ethers";

import "./tasks/simulateSession";
import "./tasks/simulateLiquidity";
import "./tasks/grantCredits";
import solidityConfig from "./solidity.config.json";

dotenv.config({ path: path.join(__dirname, ".env.local") });
dotenv.config({ path: path.join(__dirname, ".env") });

const deployerAccounts = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];

const GNOSIS_PUBLIC_RPC = "https://rpc.gnosischain.com";

// Latest across the committed artifacts, so every deployed contract exists at the fork point.
function latestGnosisDeploymentBlock(): number {
  const dir = path.join(__dirname, "deployments", "gnosis");
  const blocks = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(path.join(dir, file), "utf8")) as { receipt?: { blockNumber?: number } })
    .map((artifact) => artifact.receipt?.blockNumber)
    .filter((block): block is number => typeof block === "number");
  if (blocks.length === 0) {
    throw new Error("No gnosis deployment artifacts with a receipt.blockNumber to pin the fork to");
  }
  return Math.max(...blocks);
}

const forkGnosis = process.env.HARDHAT_FORK === "gnosis";

const config: HardhatUserConfig = {
  solidity: {
    compilers: solidityConfig.compilers,
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
    deploy: "./deploy",
    deployments: "./deployments",
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
    // the app's mock accounts; credits are seeded to them on a local chain
    alice: {
      default: 0,
    },
    bob: {
      default: 1,
    },
  },
  networks: {
    hardhat: {
      saveDeployments: true,
      // estimate a send that names no gas, as a wallet does; the default fills the block gas limit, which
      // the balance check counts in full
      gas: "auto",
      ...(forkGnosis && {
        chainId: 100,
        forking: {
          url: process.env.GNOSIS_RPC_URL || GNOSIS_PUBLIC_RPC,
          blockNumber: Number(process.env.HARDHAT_FORK_BLOCK_NUMBER) || latestGnosisDeploymentBlock(),
        },
        hardfork: "prague",
        mining: { auto: true, interval: 5000 },
        chains: {
          100: { hardforkHistory: { prague: 0 } },
        },
      }),
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      saveDeployments: true,
    },
    "gnosis-fork": {
      url: "http://127.0.0.1:8545",
      chainId: 100,
      // a cold fork cache makes the first writes fetch remote state for minutes
      timeout: 600_000,
    },
    gnosis: {
      url: process.env.GNOSIS_RPC_URL || GNOSIS_PUBLIC_RPC,
      chainId: 100,
      accounts: deployerAccounts,
      saveDeployments: true,
      verify: {
        etherscan: {
          apiUrl: "https://api.blockscout.com/100/api",
          apiKey: process.env.BLOCKSCOUT_API_KEY ?? "",
        },
      },
    },
    tenderly: {
      url: process.env.TENDERLY_RPC_URL ?? "",
      accounts: deployerAccounts,
      saveDeployments: true,
    },
  },
  external: {
    // The fork carries the live gnosis deployment, so tasks read its artifacts.
    deployments: {
      "gnosis-fork": ["deployments/gnosis"],
    },
  },
};

export default config;

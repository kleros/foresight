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
import solidityConfig from "./solidity.config.json";

dotenv.config({ path: path.join(__dirname, ".env.local") });
dotenv.config({ path: path.join(__dirname, ".env") });

const deployerAccounts = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];

const GNOSIS_PUBLIC_RPC = "https://rpc.gnosischain.com";

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
  },
  networks: {
    hardhat: {
      saveDeployments: true,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      saveDeployments: true,
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
};

export default config;

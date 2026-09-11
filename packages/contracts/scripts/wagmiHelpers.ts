import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, parse } from "node:path";

import { erc20Abi, type Abi, type Address } from "viem";
import { gnosis, hardhat } from "viem/chains";

import { getSeerDeployment } from "../config/seer";

type HardhatDeployment = {
  address: Address;
  abi: Abi;
};

export type WagmiCodegenContract = {
  name: string;
  address?: Record<number, Address>;
  abi: Abi;
};

export const DEPLOYMENT_CHAINS = {
  gnosis: {
    chainId: gnosis.id,
    deploymentsDir: "gnosis",
  },
  localhost: {
    chainId: hardhat.id,
    deploymentsDir: "localhost",
  },
} as const;

export type DeploymentChainName = keyof typeof DEPLOYMENT_CHAINS;

const MOCK_CONTRACT_PREFIX = "Mock";

/** Deployed per owner by the factory, so there is an ABI to export but no singleton address. */
const ABI_ONLY_CONTRACTS = ["TradeExecutor"] as const;

export function getAbi(artifact: unknown) {
  return (artifact as { abi: Abi }).abi;
}

export async function readArtifactJson(relativePath: string) {
  const filePath = join(__dirname, "..", relativePath);
  const fileContent = await readFile(filePath, "utf8");
  return JSON.parse(fileContent) as unknown;
}

export async function readArtifacts(chainName: DeploymentChainName) {
  const { chainId, deploymentsDir } = DEPLOYMENT_CHAINS[chainName];
  const directoryPath = join(__dirname, "../deployments", deploymentsDir);

  if (!existsSync(directoryPath)) {
    return [];
  }

  const files = await readdir(directoryPath);
  const results: WagmiCodegenContract[] = [];

  for (const file of files) {
    const { name, ext } = parse(file);
    if (ext !== ".json") {
      continue;
    }

    // will exclude any mock contract be shipped in the *.viem.ts files
    if (name.startsWith(MOCK_CONTRACT_PREFIX)) {
      continue;
    }

    const fileContent = await readFile(join(directoryPath, file), "utf8");
    const jsonContent = JSON.parse(fileContent) as HardhatDeployment;
    results.push({
      name,
      address: {
        [chainId]: jsonContent.address,
      },
      abi: jsonContent.abi,
    });
  }

  return results;
}

export async function readAbiOnlyArtifacts() {
  return Promise.all(
    ABI_ONLY_CONTRACTS.map(async (name) => ({
      name,
      abi: getAbi(await readArtifactJson(`artifacts/contracts/${name}.sol/${name}.json`)),
    })),
  );
}

/**
 * Seer's contracts the app calls on gnosis, by the name each is deployed under. The adapter is a
 * constant on `GnosisRouter` with no deployment file of its own, so its address sits in
 * `deployments/external/gnosis`. sDAI ships without an ABI, so viem's ERC-20 one stands in.
 */
export async function readSeerArtifacts(chainName: DeploymentChainName): Promise<WagmiCodegenContract[]> {
  if (chainName !== "gnosis") {
    return [];
  }

  const { chainId } = DEPLOYMENT_CHAINS[chainName];
  const router = getSeerDeployment(chainId, "GnosisRouter");
  const sDai = getSeerDeployment(chainId, "SavingsXDai");
  if (!router || !sDai) {
    throw new Error("GnosisRouter and SavingsXDai must both be deployed under @seer-pm/contracts for gnosis");
  }
  const adapter = (await readArtifactJson("deployments/external/gnosis/SavingsXDaiAdapter.json")) as HardhatDeployment;

  return [
    { name: "GnosisRouter", address: { [chainId]: router.address }, abi: router.abi as Abi },
    { name: "SavingsXDai", address: { [chainId]: sDai.address }, abi: erc20Abi },
    { name: "SavingsXDaiAdapter", address: { [chainId]: adapter.address }, abi: adapter.abi },
  ];
}

export function requireArtifacts(chainName: DeploymentChainName, contracts: WagmiCodegenContract[]) {
  if (contracts.length === 0) {
    throw new Error(
      `No ${chainName} deployments found in deployments/${DEPLOYMENT_CHAINS[chainName].deploymentsDir}/ - deploy to ${chainName} before running codegen`,
    );
  }
}

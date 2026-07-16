import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, parse } from "node:path";

import { gnosis, hardhat } from "viem/chains";
import type { Abi, Address } from "viem";

type HardhatDeployment = {
  address: Address;
  abi: Abi;
};

export type WagmiCodegenContract = {
  name: string;
  address: Record<number, Address>;
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

export function requireArtifacts(chainName: DeploymentChainName, contracts: WagmiCodegenContract[]) {
  if (contracts.length === 0) {
    throw new Error(
      `No ${chainName} deployments found in deployments/${DEPLOYMENT_CHAINS[chainName].deploymentsDir}/ - deploy to ${chainName} before running codegen`,
    );
  }
}

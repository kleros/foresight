import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Address } from "viem";

type DeploymentJson = {
  address: string;
};

let cachedByChain: Record<number, Address> | null = null;

function resolveSeerDeploymentsDir() {
  const requireFromPackage = createRequire(join(process.cwd(), "package.json"));
  const packageJsonPath = requireFromPackage.resolve("@seer-pm/contracts/package.json");
  return join(dirname(packageJsonPath), "deployments");
}

function readChainId(networkDir: string) {
  const chainFile = join(networkDir, ".chainId");
  if (!existsSync(chainFile)) {
    return null;
  }

  const chainId = Number.parseInt(readFileSync(chainFile, "utf8").trim(), 10);
  return Number.isNaN(chainId) ? null : chainId;
}

function readMarketFactoryAddress(networkDir: string) {
  const deploymentFile = join(networkDir, "MarketFactory.json");
  if (!existsSync(deploymentFile)) {
    return null;
  }

  const deployment = JSON.parse(readFileSync(deploymentFile, "utf8")) as DeploymentJson;
  return deployment.address as Address;
}

function loadSeerMarketFactoryByChain() {
  if (cachedByChain) {
    return cachedByChain;
  }

  const deploymentsDir = resolveSeerDeploymentsDir();
  const byChain: Record<number, Address> = {};

  for (const entry of readdirSync(deploymentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const networkDir = join(deploymentsDir, entry.name);
    const chainId = readChainId(networkDir);
    const address = readMarketFactoryAddress(networkDir);

    if (chainId === null || !address) {
      continue;
    }

    byChain[chainId] = address;
  }

  cachedByChain = byChain;
  return byChain;
}

export function getSeerMarketFactoryByChain(): Record<number, Address> {
  return { ...loadSeerMarketFactoryByChain() };
}

export function getSeerMarketFactoryAddress(chainId: number) {
  return loadSeerMarketFactoryByChain()[chainId] ?? null;
}

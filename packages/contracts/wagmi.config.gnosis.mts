import { defineConfig } from "@wagmi/cli";

import { readAbiOnlyArtifacts, readArtifacts, readSeerArtifacts, requireArtifacts } from "./scripts/wagmiHelpers.ts";

export default defineConfig(async () => {
  const contracts = await readArtifacts("gnosis");
  requireArtifacts("gnosis", contracts);

  contracts.forEach((contract) => {
    console.log("Found gnosis deployment: %s", contract.name);
  });

  return {
    contracts: [...contracts, ...(await readAbiOnlyArtifacts()), ...(await readSeerArtifacts("gnosis"))],
    out: "deployments/gnosis.viem.ts",
  };
});

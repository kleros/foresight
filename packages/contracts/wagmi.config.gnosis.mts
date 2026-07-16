import { defineConfig } from "@wagmi/cli";

import { readArtifacts, requireArtifacts } from "./scripts/wagmiHelpers.ts";

export default defineConfig(async () => {
  const contracts = await readArtifacts("gnosis");
  requireArtifacts("gnosis", contracts);

  contracts.forEach((contract) => {
    console.log("Found gnosis deployment: %s", contract.name);
  });

  return {
    out: "deployments/gnosis.viem.ts",
    contracts,
  };
});

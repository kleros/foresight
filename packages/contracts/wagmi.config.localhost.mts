import { defineConfig } from "@wagmi/cli";

import { readArtifacts, requireArtifacts } from "./scripts/wagmiHelpers.ts";

export default defineConfig(async () => {
  const contracts = await readArtifacts("localhost");
  requireArtifacts("localhost", contracts);

  contracts.forEach((contract) => {
    console.log("Found localhost deployment: %s", contract.name);
  });

  return {
    out: "deployments/localhost.viem.ts",
    contracts,
  };
});

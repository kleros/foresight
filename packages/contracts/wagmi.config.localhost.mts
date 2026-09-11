import { defineConfig } from "@wagmi/cli";

import { readAbiOnlyArtifacts, readArtifacts, readSeerArtifacts, requireArtifacts } from "./scripts/wagmiHelpers.ts";

export default defineConfig(async () => {
  const contracts = await readArtifacts("localhost");
  requireArtifacts("localhost", contracts);

  contracts.forEach((contract) => {
    console.log("Found localhost deployment: %s", contract.name);
  });

  return {
    contracts: [...contracts, ...(await readAbiOnlyArtifacts()), ...(await readSeerArtifacts("localhost"))],
    out: "deployments/localhost.viem.ts",
  };
});

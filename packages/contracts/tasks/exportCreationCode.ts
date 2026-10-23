import { writeFileSync } from "node:fs";
import path from "node:path";

import { task } from "hardhat/config";

task(
  "export-creation-code",
  "Writes TradeExecutor's creation code for the app to derive trade wallet addresses",
).setAction(async (_args, hre) => {
  await hre.run("compile", { quiet: true });
  const { bytecode } = await hre.artifacts.readArtifact("TradeExecutor");
  const file = path.join(__dirname, "..", "deployments", "creationCode.ts");
  writeFileSync(
    file,
    [
      "// Written by `hardhat export-creation-code` from the compiled TradeExecutor; do not edit.",
      "",
      "/** TradeExecutor's creation code, which TradeExecutorFactory deploys with CREATE2 for each owner. */",
      "export const tradeExecutorCreationCode =",
      `  "${bytecode}" as const;`,
      "",
    ].join("\n"),
  );
  console.log("Wrote %s", path.relative(process.cwd(), file));
});

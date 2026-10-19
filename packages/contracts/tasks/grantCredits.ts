import { readFileSync } from "node:fs";
import path from "node:path";

import { task, types } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

const CREDITS_ABI = [
  "function governor() view returns (address)",
  "function mint(address to, uint256 amount)",
  "function balanceOf(address owner) view returns (uint256)",
];

interface GrantCreditsArgs {
  to: string;
  amount: string;
}

// gnosis-fork reads the live token's address; a local chain uses its Credits-tag mock
async function creditsAddress(hre: HardhatRuntimeEnvironment): Promise<string> {
  if (hre.network.name === "gnosis-fork") {
    const file = path.join(__dirname, "..", "deployments", "external", "gnosis", "ForesightCredits.json");
    return (JSON.parse(readFileSync(file, "utf8")) as { address: string }).address;
  }
  return (await hre.deployments.get("ForesightCredits")).address;
}

async function recipient(hre: HardhatRuntimeEnvironment, to: string): Promise<string> {
  if (hre.ethers.isAddress(to)) return to;
  const named = (await hre.getNamedAccounts())[to];
  if (!named) throw new Error(`"${to}" is neither an address nor a named account (alice, bob).`);
  return named;
}

task("grant-credits", "Mints Foresight credits to an account, as the token's governor (local chains only)")
  .addOptionalParam("to", "Address or named account", "alice", types.string)
  .addOptionalParam("amount", "Credits, in whole or decimal units", "100", types.string)
  .setAction(async ({ to, amount }: GrantCreditsArgs, hre) => {
    if (hre.network.name !== "gnosis-fork" && hre.network.name !== "localhost") {
      throw new Error(
        `grant-credits impersonates the governor, so it runs on localhost or gnosis-fork, not ${hre.network.name}.`,
      );
    }
    const token = await creditsAddress(hre);
    const account = await recipient(hre, to);
    const credits = new hre.ethers.Contract(token, CREDITS_ABI, hre.ethers.provider);
    const governor = (await credits.getFunction("governor")()) as string;

    await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [governor] });
    try {
      await hre.network.provider.request({ method: "hardhat_setBalance", params: [governor, "0x56BC75E2D63100000"] });
      const signer = await hre.ethers.getSigner(governor);
      const wad = hre.ethers.parseUnits(amount, 18);
      await (await credits.connect(signer).getFunction("mint")(account, wad)).wait();
    } finally {
      await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [governor] });
    }

    const balance = (await credits.getFunction("balanceOf")(account)) as bigint;
    console.log(
      `${to} (${account}) now holds ${hre.ethers.formatUnits(balance, 18)} Foresight credits on ${hre.network.name}.`,
    );
  });

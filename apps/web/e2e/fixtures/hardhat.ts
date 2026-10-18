import { test as base } from "@playwright/test";
import {
  createTestClient,
  encodeFunctionData,
  http,
  isAddressEqual,
  parseAbi,
  parseEther,
  publicActions,
  walletActions,
  type Address,
} from "viem";
import { gnosis, hardhat } from "viem/chains";

import { LOCAL_RPC_URL } from "@/config/chains";

const client = createTestClient({
  chain: hardhat,
  mode: "hardhat",
  transport: http(),
})
  .extend(publicActions)
  .extend(walletActions);

export type HardhatClient = typeof client;

export const test = base.extend<{ hardhat: HardhatClient }>({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  hardhat: async ({ page }, use) => {
    await use(client);
  },
});

/** Gnosis' Foresight credits governor: an admin of the token and the manager's governor. */
export const CREDITS_GOVERNOR: Address = "0x4EDCA105188a0783Ab3A6f09c50567D1E3F8591D";

const CREDITS_ADMIN_ABI = parseAbi([
  "function governor() view returns (address)",
  "function mint(address to, uint256 amount)",
]);

// signs as chain 100, which the gnosis fork answers to; the `hardhat` client signs as 31337
const fork = createTestClient({ chain: gnosis, mode: "hardhat", transport: http(LOCAL_RPC_URL) })
  .extend(publicActions)
  .extend(walletActions);

/** Mints `amount` Foresight credits to `to` on the gnosis fork, as the governor impersonated for the one call. */
export async function grantCredits(token: Address, to: Address, amount: bigint) {
  const governor = await fork.readContract({ address: token, abi: CREDITS_ADMIN_ABI, functionName: "governor" });
  if (!isAddressEqual(governor, CREDITS_GOVERNOR)) {
    throw new Error(`The credits governor is ${governor}, not the ${CREDITS_GOVERNOR} the fixture acts as.`);
  }
  await fork.impersonateAccount({ address: CREDITS_GOVERNOR });
  try {
    if ((await fork.getBalance({ address: CREDITS_GOVERNOR })) < parseEther("1")) {
      await fork.setBalance({ address: CREDITS_GOVERNOR, value: parseEther("1") });
    }
    const hash = await fork.sendTransaction({
      account: CREDITS_GOVERNOR,
      to: token,
      data: encodeFunctionData({ abi: CREDITS_ADMIN_ABI, functionName: "mint", args: [to, amount] }),
    });
    const receipt = await fork.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Minting ${amount} credits to ${to} reverted.`);
  } finally {
    await fork.stopImpersonatingAccount({ address: CREDITS_GOVERNOR });
  }
}

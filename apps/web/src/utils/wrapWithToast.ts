import { classifyTxError } from "@foresight/tx-orchestrator";
import { waitForTransactionReceipt, type Config } from "@wagmi/core";
import type { Hash, TransactionReceipt } from "viem";

import { errorToast, infoToast, successToast } from "./toast";

/** The wallet's and the node's own messages name codes and contracts, so the toast never shows them. */
const TX_ERROR_TOAST: Record<ReturnType<typeof classifyTxError>, string> = {
  rejected: "You declined in your wallet.",
  rpc: "The network did not answer.",
  unknown: "Transaction failed.",
};

/**
 * Runs one transaction with a toast at each stage: the wallet prompt, then confirmed, failed or refused.
 * Rejects on anything but a successful receipt, so a mutation still reports the failure.
 */
export async function wrapWithToast(config: Config, send: () => Promise<Hash>): Promise<TransactionReceipt> {
  infoToast("Confirm in your wallet.");

  let receipt: TransactionReceipt;
  try {
    const hash = await send();
    receipt = await waitForTransactionReceipt(config, { hash });
  } catch (error) {
    errorToast(TX_ERROR_TOAST[classifyTxError(error)]);
    throw error;
  }

  if (receipt.status !== "success") {
    errorToast("Transaction failed.");
    throw new Error("Transaction reverted.");
  }

  successToast("Transaction confirmed.");
  return receipt;
}

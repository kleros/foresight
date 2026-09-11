import { describeTxError } from "@foresight/tx-orchestrator";
import { waitForTransactionReceipt, type Config } from "@wagmi/core";
import type { Hash, TransactionReceipt } from "viem";

import { errorToast, infoToast, successToast } from "./toast";

/**
 * Runs one transaction with a toast at each stage: sent, then confirmed, reverted or refused.
 * Rejects on anything but a successful receipt, so a mutation still reports the failure.
 */
export async function wrapWithToast(config: Config, send: () => Promise<Hash>): Promise<TransactionReceipt> {
  infoToast("Transaction initiated.");

  let receipt: TransactionReceipt;
  try {
    const hash = await send();
    receipt = await waitForTransactionReceipt(config, { hash });
  } catch (error) {
    errorToast(describeTxError(error));
    throw error;
  }

  if (receipt.status !== "success") {
    errorToast("Transaction reverted.");
    throw new Error("Transaction reverted.");
  }

  successToast("Transaction confirmed.");
  return receipt;
}

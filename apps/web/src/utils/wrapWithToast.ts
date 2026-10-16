import { classifyTxError } from "@foresight/tx-orchestrator";
import { waitForTransactionReceipt, type Config } from "@wagmi/core";
import type { Hash, TransactionReceipt } from "viem";

import { errorToast, infoToast, successToast } from "./toast";
import { chainText, OUT_OF_FUNDS, OUT_OF_FUNDS_COPY, REVERTS } from "./txErrorText";

/** The wallet's and the node's own messages name codes and contracts, so the toast never shows them. */
const TX_ERROR_TOAST: Record<ReturnType<typeof classifyTxError>, string> = {
  rejected: "You declined in your wallet.",
  rpc: "The network did not answer.",
  unknown: "Transaction failed.",
};

/** Once a hash is back the transaction is out there and may still land. */
const SENT_COPY = "Sent, not confirmed yet. Check your wallet before trying again.";

/** wagmi throws once a mined transaction reverts, so only a network failure leaves it pending. */
function afterSendCopy(error: unknown): string {
  if (REVERTS.test(chainText(error))) return TX_ERROR_TOAST.unknown;
  return classifyTxError(error) === "rpc" ? SENT_COPY : TX_ERROR_TOAST.unknown;
}

function errorCopy(error: unknown): string {
  const cause = classifyTxError(error);
  if (cause === "rejected") return TX_ERROR_TOAST.rejected;
  const text = chainText(error);
  if (OUT_OF_FUNDS.test(text)) return OUT_OF_FUNDS_COPY;
  if (REVERTS.test(text)) return TX_ERROR_TOAST.unknown;
  return TX_ERROR_TOAST[cause];
}

/**
 * Runs one transaction with a toast at each stage: the wallet prompt, then confirmed, failed or refused.
 * Rejects on anything but a successful receipt, so a mutation still reports the failure.
 */
export async function wrapWithToast(config: Config, send: () => Promise<Hash>): Promise<TransactionReceipt> {
  infoToast("Confirm in your wallet.");

  let receipt: TransactionReceipt;
  let hash: Hash | undefined;
  try {
    hash = await send();
    receipt = await waitForTransactionReceipt(config, { hash });
  } catch (error) {
    errorToast(hash ? afterSendCopy(error) : errorCopy(error));
    throw error;
  }

  if (receipt.status !== "success") {
    errorToast("Transaction failed.");
    throw new Error("Transaction reverted.");
  }

  successToast("Transaction confirmed.");
  return receipt;
}

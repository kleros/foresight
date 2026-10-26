import type { Address, Hash } from "viem";

import { shortenAddress } from "@/utils/address";

import { shownAmount } from "./funding";
import type { FundsToAdd } from "./predictSteps";
import { STEP_ID } from "../flow/stepIds";

/** A settled step of a finished run; `hash` is absent where the step was skipped. */
export interface PlacedStep {
  id: string;
  hash?: Hash;
}

export interface ReceiptLink {
  hash: Hash;
  href: string;
  /** The link's accessible name. */
  label: string;
  /** Shown beside the arrow where a row has several links. */
  text?: string;
}

export interface ReceiptRow {
  id: string;
  title: string;
  detail?: string;
  links: ReceiptLink[];
}

/**
 * A finished run's steps as the success dialog lists them. A skipped wallet step means the wallet
 * already existed, so it has no row; a skipped funds step landed unseen, so its row has no link.
 */
export function receiptRows(args: {
  steps: PlacedStep[];
  /** What the funds step added, as the run's timeline said it. */
  funds?: FundsToAdd;
  wallet?: Address;
  /** The transaction's explorer page; undefined on a chain with none. */
  txUrl: (hash: Hash) => string | undefined;
}): ReceiptRow[] {
  const { steps, funds, wallet, txUrl } = args;
  const link = (hash: Hash | undefined, label: string, text?: string): ReceiptLink[] => {
    const href = hash && txUrl(hash);
    return hash && href ? [{ href, hash, label, ...(text ? { text } : {}) }] : [];
  };
  const step = (id: string) => steps.find((entry) => entry.id === id);
  const rows: ReceiptRow[] = [];

  const created = step(STEP_ID.createExecutor);
  if (created?.hash) {
    rows.push({
      id: created.id,
      title: "Trade wallet created",
      ...(wallet ? { detail: shortenAddress(wallet) } : {}),
      links: link(created.hash, "Trade wallet transaction"),
    });
  }
  const credits = step(STEP_ID.addCredits);
  if (credits) {
    rows.push({
      id: credits.id,
      title: "Credits added",
      ...(funds?.credits ? { detail: `${shownAmount(funds.credits, 18)} credits` } : {}),
      links: link(credits.hash, "Credits transaction"),
    });
  }
  const deposit = step(STEP_ID.deposit);
  if (deposit) {
    rows.push({
      id: deposit.id,
      title: "Funds added",
      ...(funds && funds.toAdd > 0n ? { detail: `${shownAmount(funds.toAdd, funds.decimals)} ${funds.symbol}` } : {}),
      links: link(deposit.hash, "Funds transaction"),
    });
  }
  const batches = steps.filter((entry) => entry.id.startsWith("predict-"));
  if (batches.length > 0) {
    rows.push({
      id: "predict",
      title: "Prediction placed",
      links: batches.flatMap((batch, index) =>
        batches.length > 1
          ? link(batch.hash, `Prediction transaction ${index + 1} of ${batches.length}`, String(index + 1))
          : link(batch.hash, "Prediction transaction"),
      ),
    });
  }
  return rows;
}

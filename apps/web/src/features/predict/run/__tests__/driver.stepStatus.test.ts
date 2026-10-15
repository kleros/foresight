import type { FlowTx, TxGateway } from "@foresight/tx-orchestrator";
import type { Hash, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ctx, fakeQuoter, fakeReader, snapshot, WAD } from "../../flow/__tests__/support/fakes";
import { predictSteps } from "../../utils/predictSteps";
import { createPredictRun } from "../driver";
import type { PredictDriver } from "../types";

const WALLET = "0xdcee0000000000000000000000000000000c664f" as const;

/** A wallet that signs when the test says so, and a chain that never mines. */
function heldGateway() {
  const signRequests: FlowTx[] = [];
  let sign: ((hash: Hash) => void) | undefined;
  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      signRequests.push(tx);
      return new Promise<Hash>((resolve) => (sign = resolve));
    },
    waitForReceipt: () => new Promise<TransactionReceipt>(() => {}),
    getReceipt: () => Promise.resolve(null),
    isKnown: () => Promise.resolve(true),
  };
  return {
    gateway,
    signRequests,
    sign: (hash: Hash) => sign?.(hash),
  };
}

let driver: PredictDriver | undefined;
afterEach(() => driver?.dispose());

const fundsRow = (run: PredictDriver) =>
  predictSteps({
    wallet: { address: WALLET, deployed: true },
    toAdd: WAD * 3n,
    symbol: "sDAI",
    decimals: 18,
    progress: run.getProgress(),
  }).rows.find((row) => row.key === "funds");

describe("createPredictRun while the deposit is out with the wallet", () => {
  it("shows Add funds running with the wallet prompt while signing, then confirming once the hash is known", async () => {
    const held = heldGateway();
    const reader = { ...fakeReader({ deployed: true }), collateralBalance: async () => WAD * 2n };
    driver = createPredictRun({
      gateway: held.gateway,
      reader,
      quoter: fakeQuoter(),
      flowId: "predict-step-status",
      ctx: () => ctx(),
      snapshot: () => snapshot({ deposit: WAD * 3n, collateralIn: WAD * 5n, collateralBefore: WAD * 2n }),
    });

    driver.start();
    await vi.waitFor(() => expect(held.signRequests).toHaveLength(1));
    await vi.waitFor(() => expect(driver!.getProgress().stage).toBe("signing"));

    const signing = fundsRow(driver);
    expect(signing?.view).toBe("running");
    expect(signing?.subtitle).toBe("Confirm in your wallet");

    const hash = `0x${"1".padStart(64, "0")}` as Hash;
    held.sign(hash);
    await vi.waitFor(() => expect(driver!.getProgress().stage).toBe("confirming"));

    const confirming = fundsRow(driver);
    expect(confirming?.view).toBe("running");
    expect(confirming?.subtitle).toBe("Confirming…");
  });
});

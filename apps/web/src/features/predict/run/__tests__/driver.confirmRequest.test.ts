import type { FlowTx, TxGateway } from "@foresight/tx-orchestrator";
import { decodeFunctionData, erc20Abi, type Hash, type TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addresses, ctx, fakeReader, option, poolQuoter, snapshot, WAD } from "../../flow/__tests__/support/fakes";
import type { PredictRequest } from "../../flow/types";
import { createPredictRun } from "../driver";
import type { PredictDriver } from "../types";

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

describe("createPredictRun confirming at moved before anything was signed", () => {
  it("signs the funding the popup froze at Predict, not what the form holds by Confirm", async () => {
    const sends: FlowTx[] = [];
    const gateway: TxGateway = {
      sendTransaction: (tx) => {
        sends.push(tx);
        return Promise.resolve(`0x${sends.length.toString(16).padStart(64, "0")}` as Hash);
      },
      waitForReceipt: ({ hash }) =>
        Promise.resolve({
          transactionHash: hash,
          status: "success",
          blockNumber: 2n,
          logs: [],
        } as unknown as TransactionReceipt),
      getReceipt: () => Promise.resolve(null),
      isKnown: () => Promise.resolve(true),
    };
    const { startedAt: _ignored, ...pressed } = snapshot({
      deposit: WAD,
      collateralIn: 2n * WAD,
      collateralBefore: WAD,
    });
    let form: PredictRequest = { ...pressed, startedAt: 1 };
    let tradeWallet = WAD;
    const driver = createPredictRun({
      gateway,
      reader: { ...fakeReader({ deployed: true }), collateralBalance: () => Promise.resolve(tradeWallet) },
      quoter: poolQuoter([option(1)]),
      flowId: "confirm-request",
      ctx: () => ctx(),
      snapshot: () => form,
    });
    drivers.push(driver);

    // held to no plan for the option, so the route check stops at moved
    driver.start({ plans: {} });
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("moved"));

    // another tab spends the trade wallet's sDAI, and a refetch re-plans the form to a 2 sDAI deposit
    tradeWallet = 0n;
    form = { ...form, deposit: 2n * WAD, collateralBefore: 0n };
    driver.confirm();
    await vi.waitFor(() => expect(["halted", "complete"]).toContain(driver.getProgress().stage));

    const deposited = sends
      .filter((tx) => tx.to === addresses.collateral)
      .map((tx) => decodeFunctionData({ abi: erc20Abi, data: tx.data! }).args[1]);
    expect(deposited).not.toContain(2n * WAD);
    expect(driver.getProgress().failure?.reason).toBe("balance");
  });
});

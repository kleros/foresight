import type { FlowTx, TxGateway } from "@foresight/tx-orchestrator";
import type { Hash, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lensQuoterOn, nodeAnswers, type NodeAnswer } from "@/lib/swap/__tests__/support/lensNode";
import type { SwapQuoter } from "@/lib/swap/types";

import {
  addresses,
  ctx,
  fakeQuoter,
  fakeReader,
  option,
  quoterFor,
  snapshot,
} from "../../flow/__tests__/support/fakes";
import type { PredictOption } from "../../flow/types";
import { predictSteps } from "../../utils/predictSteps";
import { createPredictRun } from "../driver";
import type { PredictDriver, PredictFailureReason, PredictProgress } from "../types";

function fakeGateway(): TxGateway & { readonly signRequests: FlowTx[]; cancelNextInWallet: () => void } {
  const signRequests: FlowTx[] = [];
  const receipt = (hash: Hash): TransactionReceipt =>
    ({ transactionHash: hash, status: "success", blockNumber: 19_000_000n }) as TransactionReceipt;
  let cancelNext = false;

  return {
    signRequests,
    cancelNextInWallet: () => {
      cancelNext = true;
    },
    sendTransaction: (tx) => {
      signRequests.push(tx);
      return Promise.resolve(`0x${signRequests.length.toString(16).padStart(64, "0")}` as Hash);
    },
    waitForReceipt: ({ hash, onReplaced }) => {
      if (!cancelNext) return Promise.resolve(receipt(hash));
      cancelNext = false;
      const cancel = `0x${"c".repeat(64)}` as Hash;
      onReplaced?.({ reason: "cancelled", hash: cancel });
      return Promise.resolve(receipt(cancel));
    },
    getReceipt: (hash) => Promise.resolve(receipt(hash)),
    isKnown: () => Promise.resolve(true),
  };
}

const isDeposit = (tx: FlowTx) => tx.to === addresses.collateral;

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

function setup(quoter: SwapQuoter, options: PredictOption[] = [option(1)]) {
  const gateway = fakeGateway();
  const driver = createPredictRun({
    gateway,
    reader: fakeReader({ deployed: true }),
    quoter,
    flowId: `predict-quote-failure-${drivers.length}`,
    ctx: () => ctx(),
    snapshot: () => snapshot({ options }),
  });
  drivers.push(driver);
  return { gateway, driver };
}

async function settled(driver: PredictDriver) {
  await vi.waitFor(() => expect(["halted", "complete"]).toContain(driver.getProgress().stage));
  return driver.getProgress();
}

/** What the popup says about a halted run. */
const message = (progress: PredictProgress) =>
  predictSteps({ wallet: null, toAdd: 0n, symbol: "sDAI", decimals: 18, progress }).failure;

const withReason = (progress: PredictProgress, reason: PredictFailureReason): PredictProgress => ({
  ...progress,
  failure: { reason, retryable: false },
});

/** A quoter that cannot reach the node until `recover` is called, then quotes as `fakeQuoter` does. */
function flakyQuoter(answer: NodeAnswer, failAfter = 0) {
  const down = lensQuoterOn(answer);
  const up = fakeQuoter();
  let asked = 0;
  let recovered = false;
  return {
    recover: () => {
      recovered = true;
    },
    quote: ((request) => {
      asked += 1;
      return recovered || asked <= failAfter ? up.quote(request) : down.quote(request);
    }) satisfies SwapQuoter["quote"],
  };
}

const failures: Array<[string, NodeAnswer]> = [
  ["the node cannot be reached", nodeAnswers.unreachable],
  ["no quoter is deployed at the address", nodeAnswers.noCode],
];

describe("createPredictRun when the quoter cannot be asked", () => {
  it.each(failures)("halts before the deposit as a retryable quote failure when %s", async (_, answer) => {
    const { gateway, driver } = setup(lensQuoterOn(answer));

    driver.start();
    const progress = await settled(driver);

    expect(progress.stage).toBe("halted");
    expect(progress.failure).toEqual({ reason: "quote", retryable: true });
    expect(gateway.signRequests.filter(isDeposit)).toEqual([]);
  });

  it.each(failures)(
    "tells the visitor the prices could not be fetched, not that no trade exists, when %s",
    async (_, answer) => {
      const { driver } = setup(lensQuoterOn(answer));

      driver.start();
      const progress = await settled(driver);

      expect(message(progress)).toMatch(/prices could not be fetched/i);
      expect(message(progress)).not.toBe(message(withReason(progress, "no-route")));
    },
  );

  it.each(failures)("halts the whole run when %s for one option while another routes", async (_, answer) => {
    const failing = option(1);
    const routing = option(2);
    const { gateway, driver } = setup(quoterFor(failing, lensQuoterOn(answer), fakeQuoter()), [failing, routing]);

    driver.start();
    const progress = await settled(driver);

    expect(progress.failure).toEqual({ reason: "quote", retryable: true });
    expect(progress.skipped).toEqual([]);
    expect(gateway.signRequests.filter(isDeposit)).toEqual([]);
  });

  it("halts as a quote failure when no option of several can be quoted", async () => {
    const { gateway, driver } = setup(lensQuoterOn(nodeAnswers.unreachable), [option(1), option(2)]);

    driver.start();
    const progress = await settled(driver);

    expect(progress.failure).toEqual({ reason: "quote", retryable: true });
    expect(gateway.signRequests.filter(isDeposit)).toEqual([]);
  });

  it("goes through on retry once the quoter answers again, depositing once", async () => {
    const quoter = flakyQuoter(nodeAnswers.unreachable);
    const { gateway, driver } = setup(quoter);

    driver.start();
    await settled(driver);
    quoter.recover();
    driver.retry();
    const progress = await settled(driver);

    expect(progress.stage).toBe("complete");
    expect(gateway.signRequests.filter(isDeposit)).toHaveLength(1);
  });

  it("pauses for a retry, without a second deposit, when the quoter fails after the deposit", async () => {
    // The route check quotes one sell and one buy; the build's quotes are the ones that fail.
    const quoter = flakyQuoter(nodeAnswers.unreachable, 2);
    const { gateway, driver } = setup(quoter);

    driver.start();
    const halted = await settled(driver);
    expect(halted.failure).toEqual({ reason: "quote", retryable: true });

    quoter.recover();
    driver.retry();
    const progress = await settled(driver);

    expect(progress.stage).toBe("complete");
    expect(gateway.signRequests.filter(isDeposit)).toHaveLength(1);
  });

  it("reports a batch cancelled in the wallet on the retry as cancelled, not as the earlier quote failure", async () => {
    const quoter = flakyQuoter(nodeAnswers.unreachable, 2);
    const { gateway, driver } = setup(quoter);

    driver.start();
    expect((await settled(driver)).failure).toEqual({ reason: "quote", retryable: true });
    quoter.recover();
    gateway.cancelNextInWallet();
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure).toBeDefined());

    expect(driver.getProgress().failure?.reason).toBe("cancelled");
  });
});

describe("createPredictRun when the quoter answers that no route exists", () => {
  it("halts as no-route, not retryable, before the deposit", async () => {
    const { gateway, driver } = setup(lensQuoterOn(nodeAnswers.noRoute));

    driver.start();
    const progress = await settled(driver);

    expect(progress.failure).toEqual({ reason: "no-route", retryable: false });
    expect(gateway.signRequests.filter(isDeposit)).toEqual([]);
  });

  it("leaves out the option with no route and trades the one that routes", async () => {
    const stuck = option(1);
    const routing = option(2);
    const { driver } = setup(quoterFor(stuck, lensQuoterOn(nodeAnswers.noRoute), fakeQuoter()), [stuck, routing]);

    driver.start();
    const progress = await settled(driver);

    expect(progress.stage).toBe("complete");
    expect(progress.skipped).toEqual([stuck.childMarket]);
  });
});

import type { FlowTx, TxGateway } from "@foresight/tx-orchestrator";
import type { Hash, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addresses,
  chainState,
  ctx,
  fakeQuoter,
  fakeReader,
  option,
  snapshot,
  WAD,
} from "../../flow/__tests__/support/fakes";
import type { OptionChainState, PredictSnapshot } from "../../flow/types";
import { MIN_LEG_WEI } from "../../utils/plan";
import { sqrtPriceX96FromPrice } from "../../utils/poolMath";
import { predictSteps } from "../../utils/predictSteps";
import { createPredictRun } from "../driver";
import type { PredictDriver, PredictProgress } from "../types";

/** A wallet that signs everything and a chain that mines it. */
function fakeGateway(): TxGateway & { readonly signRequests: FlowTx[] } {
  const signRequests: FlowTx[] = [];
  const receipt = (hash: Hash): TransactionReceipt =>
    ({ transactionHash: hash, status: "success", blockNumber: 19_000_000n }) as TransactionReceipt;

  return {
    signRequests,
    sendTransaction: (tx) => {
      signRequests.push(tx);
      return Promise.resolve(`0x${signRequests.length.toString(16).padStart(64, "0")}` as Hash);
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
    getReceipt: (hash) => Promise.resolve(receipt(hash)),
    isKnown: () => Promise.resolve(true),
  };
}

/** A collateral transfer or an xDAI payment to the adapter: money into the trade wallet. */
const isDeposit = (tx: FlowTx) => tx.to === addresses.collateral || tx.to === addresses.sDaiAdapter;

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

async function runToEnd(snap: PredictSnapshot, state: () => OptionChainState) {
  const gateway = fakeGateway();
  const driver = createPredictRun({
    gateway,
    reader: fakeReader({ deployed: true, state }),
    quoter: fakeQuoter(),
    flowId: `predict-test-${drivers.length}`,
    ctx: () => ctx(),
    snapshot: () => snap,
  });
  drivers.push(driver);

  driver.start();
  await vi.waitFor(() => expect(["halted", "complete"]).toContain(driver.getProgress().stage));

  return { progress: driver.getProgress(), deposits: gateway.signRequests.filter(isDeposit) };
}

/** What the popup says about a halted run. */
const message = (progress: PredictProgress) =>
  predictSteps({ wallet: null, toAdd: 0n, symbol: "sDAI", decimals: 18, progress }).failure;

const withReason = (progress: PredictProgress, reason: "rpc" | "unknown"): PredictProgress => ({
  ...progress,
  failure: { reason, retryable: reason === "rpc" },
});

/** Both pools already priced at the estimate, so nothing moves the market toward it. */
const atTarget = (targetPriceWad: bigint) => (): OptionChainState =>
  chainState({
    pools: {
      up: { sqrtPriceX96: sqrtPriceX96FromPrice(targetPriceWad, true), liquidity: WAD, outcomeIsToken0: true },
      down: { sqrtPriceX96: sqrtPriceX96FromPrice(WAD - targetPriceWad, true), liquidity: WAD, outcomeIsToken0: true },
    },
  });

function expectNoRouteHalt(result: Awaited<ReturnType<typeof runToEnd>>) {
  const { progress, deposits } = result;

  expect(progress.stage).toBe("halted");
  expect(progress.failure).toBeDefined();
  expect(progress.failure!.reason).not.toBe("rpc");
  expect(progress.failure!.retryable).toBe(false);
  expect(deposits).toEqual([]);

  const shown = message(progress);
  expect(shown).toBeDefined();
  expect(shown).not.toBe(message(withReason(progress, "rpc")));
  expect(shown).not.toBe(message(withReason(progress, "unknown")));
}

describe("createPredictRun when no route moves the market", () => {
  it.each([
    ["one wei", 1n],
    ["0.001 sDAI", 10n ** 15n],
    ["just under the smallest leg", MIN_LEG_WEI - 1n],
  ])("halts a dust amount (%s) before the deposit, without blaming the network", async (_, amount) => {
    const result = await runToEnd(snapshot({ deposit: amount, collateralIn: amount }), () => chainState());

    expectNoRouteHalt(result);
  });

  it.each([
    ["25%", WAD / 4n],
    ["50%", WAD / 2n],
    ["80%", (WAD * 4n) / 5n],
  ])("halts an estimate the market already sits at (%s) before the deposit", async (_, target) => {
    const result = await runToEnd(snapshot({ options: [option(1, target)] }), atTarget(target));

    expectNoRouteHalt(result);
  });

  it("tells a returning visitor with nothing to add and nothing held the same thing, not the network message", async () => {
    const returning = await runToEnd(snapshot({ deposit: 0n, collateralIn: 0n, collateralBefore: 0n }), () =>
      chainState(),
    );
    const dust = await runToEnd(snapshot({ deposit: 10n ** 15n, collateralIn: 10n ** 15n }), () => chainState());

    expect(returning.progress.stage).toBe("halted");
    expect(returning.progress.failure?.reason).not.toBe("rpc");
    expect(message(returning.progress)).not.toBe(message(withReason(returning.progress, "rpc")));
    expect(message(returning.progress)).toBe(message(dust.progress));
  });
});

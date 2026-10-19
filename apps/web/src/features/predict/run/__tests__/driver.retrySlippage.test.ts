import type { FlowTx, TxGateway } from "@foresight/tx-orchestrator";
import type { Hash, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addresses,
  chainState,
  ctx,
  fakeCreditsQuoter,
  fakeQuoter,
  fakeReader,
  option,
  snapshot,
  WAD,
} from "../../flow/__tests__/support/fakes";
import { previewCreditsSwap } from "../../flow/plan";
import type { PredictSlippage, PredictSnapshot } from "../../flow/types";
import { CREDITS_SLIPPAGE_BPS, SLIPPAGE_BPS } from "../../oracle/tolerances";
import { previewTrades, type PreviewTrades } from "../../utils/plan";
import { createPredictRun } from "../driver";
import type { PredictDriver } from "../types";

const OPTION = option(1);
const KEY = OPTION.childMarket.toLowerCase();
const STATE = chainState();
const CREDITS = 2n * WAD;
const AUTO: PredictSlippage = { tradeBps: SLIPPAGE_BPS, creditsBps: CREDITS_SLIPPAGE_BPS };

const planOn = (split: bigint, slippageBps: number): PreviewTrades =>
  previewTrades(
    {
      pools: STATE.pools,
      targetPriceWad: OPTION.targetPriceWad,
      held: STATE.held,
      splitAmount: STATE.underlying + split,
    },
    slippageBps,
  )!;

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

/** Every send lands but the first executor batch, which reverts; `settings` is what the popup's settings say now. */
function setup(request: PredictSnapshot) {
  let settings = request.slippage;
  const sent: FlowTx[] = [];
  const reverted = new Set<Hash>();
  const receipt = (hash: Hash) =>
    ({
      transactionHash: hash,
      status: reverted.has(hash) ? "reverted" : "success",
      blockNumber: 2n,
      logs: [],
    }) as unknown as TransactionReceipt;
  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      sent.push(tx);
      const hash = `0x${sent.length.toString(16).padStart(64, "0")}` as Hash;
      if (tx.to === addresses.executor && !sent.slice(0, -1).some((each) => each.to === addresses.executor)) {
        reverted.add(hash);
      }
      return Promise.resolve(hash);
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
    getReceipt: (hash) => Promise.resolve(receipt(hash)),
    isKnown: () => Promise.resolve(true),
  };
  const reader = fakeReader({
    deployed: true,
    state: () => STATE,
    credits: { [addresses.executor]: request.creditsToSpend },
  });
  const creditsQuoter = fakeCreditsQuoter({});
  const driver = createPredictRun({
    gateway,
    reader,
    quoter: fakeQuoter(),
    creditsQuoter,
    flowId: `retry-slippage-${drivers.length}`,
    ctx: () => ctx(),
    snapshot: () => ({ ...request, slippage: settings }),
    slippage: () => settings,
  });
  drivers.push(driver);
  const preview = (creditsBps: number) =>
    previewCreditsSwap(ctx(), request.creditsToSpend, creditsBps, { reader, creditsQuoter });
  return { driver, sent, preview, setSettings: (next: PredictSlippage) => (settings = next) };
}

const stageIs = (driver: PredictDriver, stage: string) =>
  vi.waitFor(() => expect(driver.getProgress().stage).toBe(stage));

const sdaiRun = snapshot({ options: [OPTION], deposit: WAD, collateralIn: WAD, slippage: AUTO });
const creditsRun = snapshot({
  options: [OPTION],
  deposit: 0n,
  collateralIn: 0n,
  creditsToSpend: CREDITS,
  slippage: AUTO,
});

describe("a retry after the slippage settings changed", () => {
  it("re-plans the reverted batch at the new trade slippage and stops at moved before signing it", async () => {
    const { driver, sent, setSettings } = setup(sdaiRun);
    driver.start({ plans: { [KEY]: planOn(WAD, SLIPPAGE_BPS) } });
    await stageIs(driver, "halted");
    expect(driver.getProgress().failure?.reason).toBe("reverted");
    const signed = sent.length;

    setSettings({ ...AUTO, tradeBps: 1_000 });
    driver.retry();
    await stageIs(driver, "moved");

    expect(driver.getProgress().moved?.plans[KEY]).toEqual(planOn(WAD, 1_000));
    expect(sent).toHaveLength(signed);

    driver.confirm();
    await stageIs(driver, "complete");
    expect(sent).toHaveLength(signed + 1);
  });

  it("retries straight on with the settings unchanged", async () => {
    const { driver, sent } = setup(sdaiRun);
    driver.start({ plans: { [KEY]: planOn(WAD, SLIPPAGE_BPS) } });
    await stageIs(driver, "halted");
    const signed = sent.length;

    driver.retry();
    await stageIs(driver, "complete");

    expect(sent).toHaveLength(signed + 1);
  });

  it("quotes the credits swap again at the new credits slippage and stops at moved", async () => {
    const { driver, sent, preview, setSettings } = setup(creditsRun);
    const shown = await preview(CREDITS_SLIPPAGE_BPS);
    driver.start({ plans: { [KEY]: planOn(shown.minted, SLIPPAGE_BPS) }, credits: shown });
    await stageIs(driver, "halted");
    const signed = sent.length;

    setSettings({ ...AUTO, creditsBps: 100 });
    driver.retry();
    await stageIs(driver, "moved");

    expect(driver.getProgress().moved?.credits).toEqual(await preview(100));
    expect(sent).toHaveLength(signed);
  });
});
